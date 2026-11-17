// M3-03 — compare chaque vue de coût à sa version _v2 (fn_convert_factor) sur toute la
// base : lignes présentes d'un côté et pas de l'autre, colonnes numériques arrondies à
// 6 décimales. Zéro écart attendu avant toute bascule du code.
//
// Usage (depuis server/) : npx tsx scripts/compare-unit-views.ts
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

export const UNIT_VIEWS = ['v_recipe_direct_cost', 'v_recipe_total_cost', 'v_recipe_component_cost', 'v_rcomp_cost', 'v_recipe_explosion', 'v_impossible_unit_conversions'];

/** Requête qui compte les lignes de `a` absentes de `b` (colonnes numériques arrondies). */
export async function diffQuery(client: { query: (q: string, p?: unknown[]) => Promise<{ rows: any[] }> }, a: string, b: string) {
  const cols = (await client.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`, [a])).rows;
  const sel = cols.map(c => /numeric|double|real/.test(c.data_type) ? `ROUND(${c.column_name}::numeric, 6) AS ${c.column_name}` : c.column_name).join(', ');
  return `SELECT COUNT(*)::int AS n FROM (SELECT ${sel} FROM ${a} EXCEPT ALL SELECT ${sel} FROM ${b}) d`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  let total = 0;
  for (const v of UNIT_VIEWS) {
    const t0 = Date.now();
    const left = (await client.query(await diffQuery(client, v, `${v}_v2`))).rows[0].n;
    const right = (await client.query(await diffQuery(client, `${v}_v2`, v))).rows[0].n;
    const rows = (await client.query(`SELECT COUNT(*)::int AS n FROM ${v}`)).rows[0].n;
    total += left + right;
    console.log(`${left + right === 0 ? '✓' : '✗'} ${v} : ${rows} lignes, ${left} absentes de _v2, ${right} en trop dans _v2 (${Date.now() - t0} ms)`);
  }
  console.log(total === 0 ? '\nZéro écart.' : `\n${total} écart(s).`);
  await client.end();
  process.exit(total === 0 ? 0 : 1);
}
