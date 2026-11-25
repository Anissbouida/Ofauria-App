import { APP_MODULES, PERMISSIONS, isBusinessVerb, isDataScope } from '@ofauria/shared';
import { userExceptionRepository, type ModuleExceptionRow } from '../repositories/user-exception.repository.js';
import { effectiveRights, roleOnlyRights, userRoleContext } from './access-rights.js';
import { applyExceptions, evaluateSod, moduleKeys, unionRights, type RightRow, type SodViolation } from './access-rules.js';
import { invalidatePermissionCaches, permissionsOfRoles } from './permissions.js';
import { activeSodRules, sodEnforcementMode } from './governance.js';

/**
 * Exceptions individuelles (refonte Utilisateurs, lot 6, mig 706). Elles s'ajoutent aux rôles :
 *  - sur un module : les droits saisis remplacent ceux des rôles pour ce module seulement ;
 *  - sur une action précise : la clé est accordée ou retirée, quoi qu'en disent les rôles.
 * Motif obligatoire, date de fin facultative (incluse). L'effet se lit par rapport aux rôles :
 * accordé (plus que les rôles), retiré (moins), modifié (les deux), sans effet.
 */

export type ExceptionEffect = 'grant' | 'revoke' | 'change' | 'none';

export class ExceptionError extends Error {
  constructor(message: string, public status = 400, public violations: SodViolation[] = []) { super(message); }
}

const MODULES = new Set<string>(Object.values(APP_MODULES));
const DEFS = PERMISSIONS as Record<string, { module: string; label: string }>;
const SCOPE_RANK: Record<string, number> = { own: 0, store: 1, all: 2 };
const FLAGS = ['can_view', 'can_create', 'can_edit', 'can_delete'] as const;
const EMPTY: RightRow = { module: '', can_view: false, can_create: false, can_edit: false, can_delete: false, config: {} };

const verbsOf = (r: RightRow) => Array.isArray(r.config?.verbs) ? (r.config.verbs as string[]) : [];
const scopeOf = (r: RightRow) => typeof r.config?.scope === 'string' ? r.config.scope as string : 'store';
const sectionsOf = (r: RightRow) => Array.isArray(r.config?.sections) ? (r.config.sections as string[]) : [];

/** Droits des rôles sur un module (clés historiques comprises), ou undefined. */
function roleRowFor(roleRows: RightRow[], module: string): RightRow | undefined {
  const keys = new Set(moduleKeys(module));
  const rows = roleRows.filter(r => keys.has(r.module));
  if (!rows.length) return undefined;
  return { ...unionRights(rows.map(r => ({ ...r, module })))[0] };
}

/** Effet d'une exception de module par rapport aux droits des rôles. */
export function moduleEffect(role: RightRow | undefined, ex: RightRow): ExceptionEffect {
  const r = role ?? EMPTY;
  if (!ex.can_view) return r.can_view ? 'revoke' : 'none';
  if (!r.can_view) return 'grant';
  let more = false; let less = false;
  for (const f of FLAGS) { if (ex[f] && !r[f]) more = true; if (!ex[f] && r[f]) less = true; }
  const ev = new Set(verbsOf(ex)); const rv = new Set(verbsOf(r));
  if ([...ev].some(v => !rv.has(v))) more = true;
  if ([...rv].some(v => !ev.has(v))) less = true;
  const es = SCOPE_RANK[scopeOf(ex)] ?? 1; const rs = SCOPE_RANK[scopeOf(r)] ?? 1;
  if (es > rs) more = true; if (es < rs) less = true;
  // Sections de Paramètres : liste vide = toutes.
  const exs = sectionsOf(ex); const rss = sectionsOf(r);
  if (exs.length || rss.length) {
    if (!exs.length) more = true;
    else if (!rss.length) less = true;
    else {
      if (exs.some(s => !rss.includes(s))) more = true;
      if (rss.some(s => !exs.includes(s))) less = true;
    }
  }
  return more && less ? 'change' : more ? 'grant' : less ? 'revoke' : 'none';
}

const view = (r: RightRow) => ({
  canView: r.can_view, canCreate: r.can_create, canEdit: r.can_edit, canDelete: r.can_delete,
  verbs: verbsOf(r), scope: scopeOf(r), sections: sectionsOf(r),
});

/** Exceptions d'un compte, avec leur effet et les droits de ses rôles (point de départ de la saisie). */
export async function listExceptions(userId: string) {
  const [rights, { roleCodes }, saved] = await Promise.all([
    effectiveRights(userId), userRoleContext(userId), userExceptionRepository.list(userId),
  ]);
  const roleRows = await roleOnlyRights(roleCodes);
  const roleKeys = await permissionsOfRoles(roleCodes);
  return {
    isAdmin: rights.isAdmin,
    modules: saved.modules.map((m: ModuleExceptionRow) => {
      const role = roleRowFor(roleRows, m.module);
      return {
        module: m.module, ...view(m), reason: m.reason, endsOn: m.ends_on, active: m.active,
        updatedAt: m.updated_at, updatedBy: m.updated_by_name,
        effect: moduleEffect(role, m), role: role ? view(role) : null,
      };
    }),
    actions: saved.actions.map(a => {
      const roleHolds = roleKeys.has(a.permission_key);
      return {
        key: a.permission_key, module: DEFS[a.permission_key]?.module ?? null, known: !!DEFS[a.permission_key],
        granted: a.granted, reason: a.reason, endsOn: a.ends_on, active: a.active,
        updatedAt: a.updated_at, updatedBy: a.updated_by_name, roleHolds,
        effect: (a.granted === roleHolds ? 'none' : a.granted ? 'grant' : 'revoke') as ExceptionEffect,
      };
    }),
    roleModules: roleRows.filter(r => r.can_view).map(r => ({ module: r.module, ...view(r) })),
    roleKeys: [...roleKeys].sort(),
  };
}

function today(): string { return new Date().toLocaleDateString('sv-SE'); }

function checkCommon(isAdmin: boolean, reason: string, endsOn: string | null) {
  if (isAdmin) throw new ExceptionError("L'administrateur a déjà tous les droits : aucune exception à poser.");
  if (!reason.trim()) throw new ExceptionError('Le motif est obligatoire.');
  if (endsOn && endsOn < today()) throw new ExceptionError('La date de fin est déjà passée.');
}

export interface ModuleExceptionBody {
  canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean;
  verbs?: string[]; scope?: string; sections?: string[];
  reason: string; endsOn?: string | null;
}

/**
 * Pose (ou remplace) l'exception d'un module. Refusée si elle ne change rien aux droits des rôles,
 * ou si elle crée un conflit de séparation des tâches alors que le contrôle est en « Bloquer ».
 * Rend les conflits créés (mode Observer) pour avertissement.
 */
export async function setModuleException(userId: string, module: string, body: ModuleExceptionBody, actorId: string | undefined) {
  if (!MODULES.has(module)) throw new ExceptionError(`Module inconnu : ${module}`);
  if (module === 'users') throw new ExceptionError('Le module Utilisateurs se règle par rôle.');
  const rights = await effectiveRights(userId);
  const endsOn = body.endsOn || null;
  checkCommon(rights.isAdmin, body.reason, endsOn);

  const verbs = (body.verbs ?? []).filter(isBusinessVerb);
  const canView = !!(body.canView || body.canCreate || body.canEdit || body.canDelete);
  const config: Record<string, unknown> = {};
  if (canView) {
    if (verbs.length) config.verbs = verbs;
    if (isDataScope(body.scope)) config.scope = body.scope;
    if (module === 'settings' && body.sections?.length) config.sections = body.sections.map(String).slice(0, 100);
  }
  const ex: RightRow = {
    module, can_view: canView, can_create: canView && !!body.canCreate, can_edit: canView && !!body.canEdit,
    can_delete: canView && !!body.canDelete, config,
  };

  const roleRows = await roleOnlyRights(rights.roles);
  if (moduleEffect(roleRowFor(roleRows, module), ex) === 'none') {
    throw new ExceptionError('Cette exception ne change rien aux droits de ses rôles.');
  }

  // Séparation des tâches : droits du compte une fois l'exception posée.
  const others = (await userExceptionRepository.list(userId)).modules
    .filter(m => m.active && !moduleKeys(module).includes(m.module));
  const next = { ...rights, rows: applyExceptions(roleRows, [...others, ex]) };
  const rules = await activeSodRules();
  const before = new Set(evaluateSod(rights, rules).map(v => v.code));
  const created = evaluateSod(next, rules).filter(v => !before.has(v.code));
  if (created.length && (await sodEnforcementMode()) === 'enforce') {
    throw new ExceptionError(`Conflit de séparation des tâches : ${created.map(v => v.label).join(' ; ')}`, 409, created);
  }

  await userExceptionRepository.setModule(userId, {
    module, canView: ex.can_view, canCreate: ex.can_create, canEdit: ex.can_edit, canDelete: ex.can_delete,
    config, reason: body.reason.trim(), endsOn,
  }, actorId);
  invalidatePermissionCaches();
  return { effect: moduleEffect(roleRowFor(roleRows, module), ex), sodWarnings: created };
}

export async function setActionException(userId: string, key: string, body: { granted: boolean; reason: string; endsOn?: string | null }, actorId: string | undefined) {
  if (!DEFS[key]) throw new ExceptionError(`Permission inconnue : ${key}`);
  const rights = await effectiveRights(userId);
  const endsOn = body.endsOn || null;
  checkCommon(rights.isAdmin, body.reason, endsOn);
  const roleHolds = (await permissionsOfRoles(rights.roles)).has(key);
  if (body.granted === roleHolds) {
    throw new ExceptionError(roleHolds ? 'Ses rôles accordent déjà cette permission.' : 'Ses rôles ne donnent pas cette permission : rien à retirer.');
  }
  await userExceptionRepository.setAction(userId, key, body.granted, body.reason.trim(), endsOn, actorId);
  invalidatePermissionCaches();
  return { effect: (body.granted ? 'grant' : 'revoke') as ExceptionEffect };
}

export async function removeException(userId: string, kind: 'module' | 'action', ref: string, actorId: string | undefined): Promise<boolean> {
  const ok = kind === 'module'
    ? await userExceptionRepository.removeModule(userId, ref, actorId)
    : await userExceptionRepository.removeAction(userId, ref, actorId);
  invalidatePermissionCaches();
  return ok;
}
