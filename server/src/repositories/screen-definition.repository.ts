import { db, withTransaction } from '../config/database.js';
import { SCREEN_CATALOG, screenDef, type ScreenDefinition, type ScreenElementKind } from '@ofauria/shared';

/**
 * Définitions d'écran (plan d'exécution multi-industries, étape 10, pas 10b et 10g ; mig 646).
 *
 * Résolution : profil d'industrie (chaîne d'héritage, du plus général au plus précis) →
 * société → rôle de l'utilisateur ; pour chaque élément, la portée la plus précise l'emporte.
 * Seules les définitions PUBLIÉES s'appliquent ; un brouillon se prévisualise.
 */
type Scope = { type: 'profile' | 'company' | 'role'; id: string };
type Row = { key: string; visible: boolean; order: number };
const KINDS: ScreenElementKind[] = ['columns', 'sections', 'filters'];

function mergeDefs(defs: ScreenDefinition[]): ScreenDefinition {
  const out: ScreenDefinition = {};
  for (const kind of KINDS) {
    const m = new Map<string, Row>();
    for (const d of defs) for (const r of d[kind] ?? []) m.set(r.key, { ...(m.get(r.key) ?? {}), ...r });
    if (m.size) out[kind] = [...m.values()].sort((a, b) => a.order - b.order);
  }
  const cf = new Map<string, string>();
  for (const d of defs) for (const c of d.custom_fields ?? []) cf.set(c.key, c.section);
  if (cf.size) out.custom_fields = [...cf].map(([key, section]) => ({ key, section }));
  return out;
}

/** Contrôle d'une définition contre le catalogue de l'écran ; renvoie les erreurs. */
export function validateDefinition(screenKey: string, def: ScreenDefinition): string[] {
  const screen = screenDef(screenKey);
  if (!screen) return [`Écran inconnu : ${screenKey}`];
  const errs: string[] = [];
  for (const kind of KINDS) {
    const rows = def[kind];
    if (!rows) continue;
    const catalog = screen.kinds[kind];
    if (!catalog) { errs.push(`L'écran ne propose pas de ${kind}.`); continue; }
    const known = new Map(catalog.map(e => [e.key, e]));
    const seen = new Set<string>();
    for (const r of rows) {
      const e = known.get(r.key);
      if (!e) { errs.push(`Élément inconnu : ${r.key}`); continue; }
      if (seen.has(r.key)) errs.push(`Élément en double : ${r.key}`);
      seen.add(r.key);
      if (e.locked && r.visible === false) errs.push(`« ${e.label} » ne se masque pas : ${e.locked}`);
      if (!Number.isFinite(r.order)) errs.push(`Ordre invalide pour ${r.key}`);
    }
  }
  const sections = new Set((screen.kinds.sections ?? []).map(e => e.key));
  for (const c of def.custom_fields ?? []) {
    if (!/^[a-z0-9_]{1,60}$/.test(c.key)) errs.push(`Champ personnalisé invalide : ${c.key}`);
    if (!sections.has(c.section)) errs.push(`Section inconnue pour le champ ${c.key} : ${c.section}`);
  }
  return errs;
}

export const screenDefinitionRepository = {
  catalog: () => SCREEN_CATALOG,

  /** Définition résolue pour un utilisateur (profil → société → rôle), publiée ou brouillon (aperçu). */
  async resolve(screenKey: string, ctx: { lineage: string[]; role?: string | null; preview?: boolean }): Promise<ScreenDefinition> {
    const scopes: Scope[] = [...ctx.lineage.map(id => ({ type: 'profile' as const, id })), { type: 'company', id: '' },
      ...(ctx.role ? [{ type: 'role' as const, id: ctx.role }] : [])];
    const statuses = ctx.preview ? ['publie', 'brouillon'] : ['publie'];
    const rows = (await db.query(
      `SELECT scope_type, scope_id, status, definition FROM screen_definitions
        WHERE screen_key = $1 AND status = ANY($2::text[])`, [screenKey, statuses])).rows;
    const defs: ScreenDefinition[] = [];
    for (const s of scopes) {
      const mine = rows.filter(r => r.scope_type === s.type && r.scope_id === s.id);
      // Aperçu : le brouillon remplace la version publiée de la même portée.
      const pick = mine.find(r => r.status === 'brouillon') ?? mine.find(r => r.status === 'publie');
      if (pick) defs.push(pick.definition as ScreenDefinition);
    }
    return mergeDefs(defs);
  },

  async list(screenKey: string) {
    return (await db.query(
      `SELECT id, screen_key, scope_type, scope_id, status, version_no, definition, updated_at, published_at
         FROM screen_definitions WHERE screen_key = $1 AND status <> 'archive' ORDER BY scope_type, scope_id, status`, [screenKey])).rows;
  },

  /** Enregistre le brouillon d'une portée. */
  async saveDraft(screenKey: string, scope: Scope, def: ScreenDefinition, userId?: string | null) {
    const errs = validateDefinition(screenKey, def);
    if (errs.length) return { error: 'Définition invalide', details: errs };
    const scopeId = scope.type === 'company' ? '' : scope.id;
    const r = await db.query(
      `INSERT INTO screen_definitions (screen_key, scope_type, scope_id, status, version_no, definition, updated_by)
       VALUES ($1::varchar, $2::varchar, $3::varchar, 'brouillon',
               (SELECT COALESCE(max(version_no), 0) + 1 FROM screen_definitions WHERE screen_key = $1::varchar AND scope_type = $2::varchar AND scope_id = $3::varchar),
               $4, $5)
       ON CONFLICT (screen_key, scope_type, scope_id) WHERE status = 'brouillon'
       DO UPDATE SET definition = EXCLUDED.definition, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING *`, [screenKey, scope.type, scopeId, JSON.stringify(def), userId ?? null]);
    return { definition: r.rows[0] };
  },

  /** Publie le brouillon d'une portée (la version publiée passe en archive). */
  async publish(screenKey: string, scope: Scope) {
    const scopeId = scope.type === 'company' ? '' : scope.id;
    return withTransaction(async () => {
      const draft = (await db.query(
        `SELECT id, definition FROM screen_definitions WHERE screen_key = $1 AND scope_type = $2 AND scope_id = $3 AND status = 'brouillon' FOR UPDATE`,
        [screenKey, scope.type, scopeId])).rows[0];
      if (!draft) return { error: 'Aucun brouillon à publier' };
      const errs = validateDefinition(screenKey, draft.definition);
      if (errs.length) return { error: `Définition invalide : ${errs[0]}` };
      await db.query(`UPDATE screen_definitions SET status = 'archive' WHERE screen_key = $1 AND scope_type = $2 AND scope_id = $3 AND status = 'publie'`,
        [screenKey, scope.type, scopeId]);
      await db.query(`UPDATE screen_definitions SET status = 'publie', published_at = now() WHERE id = $1`, [draft.id]);
      return { published: true };
    });
  },

  /** Retire la définition publiée et le brouillon d'une portée (retour à l'écran par défaut). */
  async reset(screenKey: string, scope: Scope) {
    const scopeId = scope.type === 'company' ? '' : scope.id;
    await db.query(`UPDATE screen_definitions SET status = 'archive' WHERE screen_key = $1 AND scope_type = $2 AND scope_id = $3 AND status IN ('publie', 'brouillon')`,
      [screenKey, scope.type, scopeId]);
    return { reset: true };
  },
};
