/**
 * M3-03 — comparaison des vues de coût d'origine et de leurs versions _v2
 * (fn_convert_factor). Utilisé par scripts/compare-unit-views.ts et par le test
 * unit-views-v2.db.test.ts.
 */
export const UNIT_VIEWS = ['v_recipe_direct_cost', 'v_recipe_total_cost', 'v_recipe_component_cost', 'v_rcomp_cost', 'v_recipe_explosion', 'v_impossible_unit_conversions'];

type Runner = { query: (q: string, p?: unknown[]) => Promise<{ rows: any[] }> };

/** Requête qui compte les lignes de `a` absentes de `b` (colonnes numériques arrondies à 6 décimales). */
export async function diffQuery(client: Runner, a: string, b: string): Promise<string> {
  const cols = (await client.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`, [a])).rows;
  const sel = cols.map(c => /numeric|double|real/.test(c.data_type) ? `ROUND(${c.column_name}::numeric, 6) AS ${c.column_name}` : c.column_name).join(', ');
  return `SELECT COUNT(*)::int AS n FROM (SELECT ${sel} FROM ${a} EXCEPT ALL SELECT ${sel} FROM ${b}) d`;
}
