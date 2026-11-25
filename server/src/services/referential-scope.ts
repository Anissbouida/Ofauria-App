import { db } from '../config/database.js';
import { sectorRepository } from '../repositories/sector.repository.js';
import { invalidateProcessRefs } from './process-referentials.js';
import { invalidateUnits } from './unit-referential.js';

/**
 * Portée sectorielle des référentiels (mig 698).
 *
 * Trois niveaux : commun (aucun rattachement), sectoriel (rattaché à des profils ou à des
 * spécialités), personnalisé (créé par la société). La règle elle-même vit en base
 * (fn_ref_applicable, fn_ref_sync_sectors) : elle s'applique quel que soit le chemin qui
 * change le secteur. Ce service ne fait que l'exposer : contexte, aperçu, resynchronisation.
 */

export type RefTier = 'common' | 'sector' | 'custom';

export type RefScopeContext = {
  /** Profils actifs de la société et leurs parents. */
  lineage: string[];
  sectors: { code: string; label: string; primary: boolean }[];
  specializations: { code: string; label: string }[];
  modules: string[];
};

export function tierOf(e: { origin?: string | null; sectors?: string[] | null; specializations?: string[] | null }): RefTier {
  if (e.origin === 'company') return 'custom';
  return (e.sectors?.length ?? 0) + (e.specializations?.length ?? 0) > 0 ? 'sector' : 'common';
}

/** Libellé et description d'une table pour la lignée donnée (le profil le plus spécifique l'emporte). */
export function resolveTableLabels(
  table: { label: string; description: string | null; label_overrides?: Record<string, { label?: string; description?: string }> | null },
  ordered: string[],
): { label: string; description: string | null } {
  let { label, description } = table;
  for (const code of ordered) {
    const o = table.label_overrides?.[code];
    if (o?.label) label = o.label;
    if (o?.description) description = o.description;
  }
  return { label, description };
}

/** Une table est proposée si son module est actif et si elle a un sens pour l'un des profils. */
export function tableRelevant(table: { module?: string | null; sectors?: string[] | null }, ctx: { lineage: string[]; modules: string[] }): boolean {
  if (table.module && !ctx.modules.includes(table.module)) return false;
  if (table.sectors?.length && !table.sectors.some(s => ctx.lineage.includes(s))) return false;
  return true;
}

export async function refScopeContext(): Promise<RefScopeContext> {
  const act = await sectorRepository.activation();
  const { rows } = await db.query(
    `SELECT fn_active_sector_lineage() AS lineage,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('code', cs.sector_code, 'label', sp.label, 'primary', cs.is_primary)
                                       ORDER BY cs.is_primary DESC, sp.label)
                        FROM company_sectors cs JOIN sector_packs sp ON sp.code = cs.sector_code), '[]'::jsonb) AS sectors,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('code', c.code, 'label', s.label) ORDER BY s.label)
                        FROM company_specializations c JOIN sector_specializations s ON s.code = c.code
                       WHERE s.sector_pack = ANY(fn_active_sector_lineage())), '[]'::jsonb) AS specializations`);
  return {
    lineage: rows[0].lineage ?? [],
    sectors: rows[0].sectors ?? [],
    specializations: rows[0].specializations ?? [],
    modules: [...act.modules].sort(),
  };
}

/**
 * Lignée ordonnée du parent vers l'enfant, profil principal en dernier : c'est l'ordre
 * d'application des libellés par profil (le principal a le dernier mot).
 */
export async function orderedLineage(): Promise<string[]> {
  const { rows } = await db.query(
    `WITH RECURSIVE l(code, depth, prim) AS (
       SELECT sector_code::text, 0, is_primary FROM company_sectors
       UNION ALL
       SELECT sp.base_sector::text, l.depth + 1, l.prim FROM l JOIN sector_packs sp ON sp.code = l.code
        WHERE sp.base_sector IS NOT NULL AND l.depth < 8)
     SELECT code FROM l GROUP BY code ORDER BY bool_or(prim), max(depth) DESC, code`);
  return rows.map(r => r.code as string);
}

export type RefPreviewTable = { table_id: string; label: string; activated: string[]; deactivated: string[]; active_after: number };

/**
 * Aperçu, sans rien écrire, de l'effet d'un choix de secteurs et de spécialités sur les
 * référentiels (assistant de configuration, changement de secteur). Les valeurs déjà
 * utilisées par des données ne sont pas annoncées « retirées » : elles resteront actives.
 */
export async function refScopePreview(sectors: string[], specializations: string[]): Promise<{ lineage: string[]; tables: RefPreviewTable[]; activated: number; deactivated: number }> {
  const { rows } = await db.query(
    `WITH ctx AS (SELECT fn_sector_lineage($1::text[]) AS lineage),
          sp AS (SELECT COALESCE(array_agg(s.code::text), '{}') AS codes FROM sector_specializations s
                  WHERE s.code = ANY($2::text[]) AND s.sector_pack = ANY((SELECT lineage FROM ctx)::text[])),
          used AS (SELECT fn_ref_entries_in_use(ARRAY(
                     SELECT re.id FROM ref_entries re
                      WHERE re.activation = 'auto' AND re.is_active
                        AND NOT fn_ref_applicable(re.sectors, re.specializations, re.excluded_sectors, (SELECT lineage FROM ctx), (SELECT codes FROM sp)))) AS ids)
     SELECT rt.id AS table_id, rt.label, rt.description, rt.label_overrides,
            (SELECT lineage FROM ctx) AS lineage,
            COALESCE(array_agg(re.label ORDER BY re.display_order, re.label)
              FILTER (WHERE re.activation = 'auto' AND NOT re.is_active
                        AND fn_ref_applicable(re.sectors, re.specializations, re.excluded_sectors, (SELECT lineage FROM ctx), (SELECT codes FROM sp))), '{}') AS activated,
            COALESCE(array_agg(re.label ORDER BY re.display_order, re.label)
              FILTER (WHERE re.activation = 'auto' AND re.is_active AND NOT (re.id = ANY((SELECT ids FROM used)::uuid[]))
                        AND NOT fn_ref_applicable(re.sectors, re.specializations, re.excluded_sectors, (SELECT lineage FROM ctx), (SELECT codes FROM sp))), '{}') AS deactivated,
            count(*) FILTER (WHERE CASE re.activation WHEN 'forced_on' THEN true WHEN 'forced_off' THEN false
                        ELSE fn_ref_applicable(re.sectors, re.specializations, re.excluded_sectors, (SELECT lineage FROM ctx), (SELECT codes FROM sp))
                             OR (re.is_active AND re.id = ANY((SELECT ids FROM used)::uuid[])) END)::int AS active_after
       FROM ref_tables rt JOIN ref_entries re ON re.table_id = rt.id
      WHERE rt.source = 'ref_entries'
      GROUP BY rt.id, rt.label, rt.description, rt.label_overrides, rt.display_order
     HAVING bool_or(cardinality(re.sectors) + cardinality(re.specializations) > 0)
      ORDER BY rt.display_order, rt.label`,
    [sectors, specializations]);
  const lineage: string[] = rows[0]?.lineage ?? [];
  const tables = rows.map(r => ({
    table_id: r.table_id as string,
    label: resolveTableLabels(r, lineage).label,
    activated: r.activated as string[], deactivated: r.deactivated as string[], active_after: r.active_after as number,
  }));
  return {
    lineage, tables,
    activated: tables.reduce((s, t) => s + t.activated.length, 0),
    deactivated: tables.reduce((s, t) => s + t.deactivated.length, 0),
  };
}

export function invalidateRefCaches() {
  invalidateProcessRefs();
  invalidateUnits();
}

/** Resynchronisation à la demande (la base le fait déjà à chaque changement de secteur). */
export async function syncRefScope(userId?: string | null): Promise<Record<string, unknown>> {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    if (userId) await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    const { rows } = await client.query(`SELECT fn_ref_sync_sectors('manual') AS result`);
    await client.query('COMMIT');
    return rows[0].result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
    invalidateRefCaches();
  }
}

/** Dernières synchronisations (ce que chaque changement de secteur a activé ou désactivé). */
export async function refSyncHistory(limit = 20) {
  const { rows } = await db.query(
    `SELECT l.id, l.created_at, l.reason, l.sectors, l.specializations, l.activated, l.deactivated, l.kept_in_use, l.details,
            u.first_name, u.last_name
       FROM ref_sector_sync_log l LEFT JOIN users u ON u.id = l.user_id
      ORDER BY l.id DESC LIMIT $1`, [limit]);
  return rows;
}
