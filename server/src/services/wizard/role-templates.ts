import { db } from '../../config/database.js';
import { ACTIVATABLE_MODULES, CORE_MODULES, PERMISSIONS, type AppModule } from '@ofauria/shared';
import { evaluateSod, moduleKeys, type RightRow, type SodRule, type SodViolation } from '../access-rules.js';
import { invalidatePermissionCaches } from '../permissions.js';
import type { WizardAnswers, WizardIssue } from './steps.js';

/**
 * Lot 11 — modèles de rôles par secteur (mig 690).
 *
 * Un modèle propose un rôle (code, libellé, rôle de base système) et ses droits par
 * module. À la publication, seuls les rôles ABSENTS sont créés : un rôle existant
 * (même code) n'est jamais modifié. Les droits sont limités aux modules retenus et
 * les droits par action sont repris du rôle de base, pour ces modules seulement :
 * un rôle issu d'un modèle n'a jamais plus que son rôle de base.
 */
export type TemplateScope = 'own' | 'store' | 'all';
export interface TemplatePermission { module: string; rights: string; scope?: TemplateScope; verbs?: string[] }
export interface RoleTemplate {
  code: string; label: string; description: string | null; base_role: string;
  sector_code: string | null; specialization_code: string | null;
  requires_modules: string[]; permissions: TemplatePermission[]; home_route: string | null;
  exists: boolean;
}

const ACTIVATABLE = new Set<string>(ACTIVATABLE_MODULES);
const DEFS = PERMISSIONS as Record<string, { module: string }>;

export async function roleTemplates(): Promise<RoleTemplate[]> {
  try {
    return (await db.query(`SELECT t.code, t.label, t.description, t.base_role, t.sector_code, t.specialization_code,
        t.requires_modules, t.permissions, t.home_route, EXISTS (SELECT 1 FROM roles r WHERE r.code = t.code) AS exists
      FROM sector_role_templates t WHERE t.is_active ORDER BY t.sort_order, t.code`)).rows as RoleTemplate[];
  } catch (e) {
    if ((e as { code?: string }).code === '42P01') return []; // migration 690 non appliquée
    throw e;
  }
}

export async function activeSodRules(): Promise<SodRule[]> {
  try {
    return (await db.query(`SELECT code, label, severity, a_module, a_right, b_module, b_right FROM sod_rules WHERE is_active`)).rows as SodRule[];
  } catch (e) {
    if ((e as { code?: string }).code === '42P01') return [];
    throw e;
  }
}

/** Droits du modèle restreints aux modules retenus (les modules non activables — tableau
 *  de bord, rapports… — restent). Format identique à role_permissions. */
export function templateRights(t: Pick<RoleTemplate, 'permissions'>, modules: readonly string[]): RightRow[] {
  const selected = new Set(modules);
  return t.permissions
    .filter(p => !ACTIVATABLE.has(p.module) || CORE_MODULES.has(p.module as AppModule) || selected.has(p.module))
    .map(p => ({
      module: p.module,
      can_view: p.rights.includes('v'), can_create: p.rights.includes('c'),
      can_edit: p.rights.includes('e'), can_delete: p.rights.includes('d'),
      config: { scope: p.scope ?? 'store', ...(p.verbs?.length ? { verbs: p.verbs } : {}) },
    }));
}

export function templateSod(rows: RightRow[], rules: SodRule[]): SodViolation[] {
  return evaluateSod({ roleCode: 'modele', baseRole: 'modele', roles: [], baseRoles: [], isAdmin: false, source: 'role', rows }, rules);
}

/** Le modèle convient-il aux secteurs (et ascendants), spécialités et modules retenus ? */
export function templateFits(t: RoleTemplate, ctx: { lineage: ReadonlySet<string>; specialties: readonly string[]; modules: readonly string[] }) {
  return (!t.sector_code || ctx.lineage.has(t.sector_code))
    && (!t.specialization_code || ctx.specialties.includes(t.specialization_code))
    && t.requires_modules.every(m => ctx.modules.includes(m));
}

const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Contrôles de l'étape Rôles : propositions inconnues (ignorées), modèles devenus hors
 *  périmètre (bloquant) et séparation des tâches (critique = bloquant). */
export function roleTemplateIssues(answers: WizardAnswers, templates: RoleTemplate[], rules: SodRule[], lineage: ReadonlySet<string>): WizardIssue[] {
  const selected = answers.roles?.data?.selected;
  if (!Array.isArray(selected)) return [];
  const issues: WizardIssue[] = [];
  const modules = list(answers.modules?.data?.selected);
  const specialties = list(answers.specialties?.data?.selected);
  const byCode = new Map(templates.map(t => [t.code, t]));
  const unknown = list(selected).filter(c => !byCode.has(c));
  if (unknown.length) issues.push({ step: 'roles', severity: 'warning', message: `Propositions non reconnues, ignorées à la publication : ${unknown.join(', ')}.` });
  for (const code of list(selected)) {
    const t = byCode.get(code);
    if (!t || t.exists) continue;
    if (!templateFits(t, { lineage, specialties, modules })) {
      issues.push({ step: 'roles', severity: 'blocking', message: `Le rôle « ${t.label} » ne correspond plus aux secteurs, spécialités ou modules retenus.` });
      continue;
    }
    for (const v of templateSod(templateRights(t, modules), rules)) {
      issues.push({ step: 'roles', severity: v.severity === 'critical' ? 'blocking' : 'warning',
        message: `Séparation des tâches — « ${t.label} » : ${v.label}.` });
    }
  }
  return issues;
}

/** Clés d'action du rôle de base conservées : modules accordés seulement, et pour un
 *  module en simple consultation, uniquement les clés de consultation. */
export function templateActionKeys(baseKeys: readonly string[], rows: RightRow[]): string[] {
  const full = new Set<string>(), viewOnly = new Set<string>();
  for (const r of rows) {
    const target = r.can_create || r.can_edit || r.can_delete ? full : r.can_view ? viewOnly : null;
    if (target) moduleKeys(r.module).forEach(m => target.add(m));
  }
  return baseKeys.filter(k => {
    const m = DEFS[k]?.module;
    if (!m) return false;
    return full.has(m) || (viewOnly.has(m) && k.endsWith('.view'));
  });
}

/** Page d'accueil reprise d'un modèle : une route interne (« / » seul = accueil général). */
export function templateHomeRoute(home: string | null | undefined): string | null {
  return home && home !== '/' && /^\/[a-z0-9/_-]*$/.test(home) && home.length <= 80 ? home : null;
}

/**
 * Crée un rôle depuis un modèle du secteur (assistant de configuration, ou « Nouveau rôle »
 * de la refonte Utilisateurs, lot 4) dans la transaction ambiante : droits du modèle limités
 * aux modules retenus, clés d'action reprises du rôle de base pour ces modules seulement,
 * page d'accueil du modèle. Le code du rôle est celui du modèle (c'est ainsi que l'origine
 * « Modèle du secteur » se lit). Rend false si le rôle existe déjà.
 */
export async function createRoleFromTemplate(t: RoleTemplate, modules: readonly string[], actor: string | null, label?: string): Promise<boolean> {
  const hasHome = !!(await db.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'roles' AND column_name = 'home_route'`)).rows.length;
  const created = (await db.query(hasHome
    ? `INSERT INTO roles (code, label, description, base_role, is_system, updated_by, home_route)
       VALUES ($1, $2, $3, $4, false, $5, $6) ON CONFLICT (code) DO NOTHING RETURNING code`
    : `INSERT INTO roles (code, label, description, base_role, is_system, updated_by)
       VALUES ($1, $2, $3, $4, false, $5) ON CONFLICT (code) DO NOTHING RETURNING code`,
  hasHome ? [t.code, label || t.label, t.description, t.base_role, actor, templateHomeRoute(t.home_route)]
    : [t.code, label || t.label, t.description, t.base_role, actor])).rows[0];
  if (!created) return false;
  const rows = templateRights(t, modules);
  for (const r of rows) {
    await db.query(`INSERT INTO role_permissions (role_code, module, can_view, can_create, can_edit, can_delete, config)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`, [t.code, r.module, r.can_view, r.can_create, r.can_edit, r.can_delete, JSON.stringify(r.config)]);
  }
  if ((await db.query(`SELECT to_regclass('public.role_action_permissions') AS t`)).rows[0]?.t) {
    const baseKeys = (await db.query(`SELECT permission_key FROM role_action_permissions WHERE role_code = $1`, [t.base_role])).rows.map(r => r.permission_key as string);
    const keys = templateActionKeys(baseKeys, rows);
    if (keys.length) await db.query(`INSERT INTO role_action_permissions (role_code, permission_key, granted_by)
      SELECT $1, unnest($2::text[]), $3 ON CONFLICT DO NOTHING`, [t.code, keys, actor]);
  }
  return true;
}

/** Publication : crée les rôles retenus absents, dans la transaction ambiante. */
export async function applyRoleTemplates(answers: WizardAnswers, actor: string) {
  const selected = list(answers.roles?.data?.selected);
  const impact = { created: [] as string[], skipped: [] as string[] };
  if (!selected.length) return impact;
  const modules = list(answers.modules?.data?.selected);
  const templates = new Map((await roleTemplates()).map(t => [t.code, t]));
  // Auteur des écritures pour les déclencheurs d'audit (portée : transaction ambiante).
  await db.query(`SELECT set_config('app.user_id', $1, true)`, [actor]);
  for (const code of [...new Set(selected)]) {
    const t = templates.get(code);
    if (!t) continue;
    if (!(await createRoleFromTemplate(t, modules, actor))) { impact.skipped.push(code); continue; }
    impact.created.push(code);
  }
  if (impact.created.length) invalidatePermissionCaches();
  return impact;
}
