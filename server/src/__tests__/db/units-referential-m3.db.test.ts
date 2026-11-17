/**
 * M3-01 — référentiel des unités par dimension (mig 554).
 *  - chaque couple d'unités historiques de même dimension a, par v_units, exactement le
 *    facteur que donne fn_unit_conv aujourd'hui ;
 *  - une ligne de fiche reçoit son unit_id par correspondance du code, y compris quand
 *    l'unité change ;
 *  - aucune ligne de composition n'est sans unité rattachée.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool } from './helpers.js';

describe.skipIf(!hasTestDb)('Référentiel des unités (M3-01)', () => {
  const p = () => testPool();
  afterAll(async () => { await closeTestPool(); });

  it('mêmes facteurs que fn_unit_conv pour toutes les unités historiques', async () => {
    const r = await p().query(
      `SELECT a.code AS f, b.code AS t, (a.factor / b.factor) AS via_ref, fn_unit_conv(a.code, b.code) AS legacy
         FROM v_units a JOIN v_units b ON a.dimension = b.dimension
        WHERE a.is_system AND b.is_system`);
    expect(r.rows.length).toBeGreaterThanOrEqual(4 * 4 + 3 * 3);
    const diffs = r.rows.filter(x => Math.abs(Number(x.via_ref) - Number(x.legacy)) > 1e-12).map(x => `${x.f}→${x.t}`);
    expect(diffs).toEqual([]);
  });

  it('chaque unité système a une dimension et un facteur', async () => {
    const r = await p().query(`SELECT code FROM v_units WHERE is_system AND (dimension IS NULL OR factor IS NULL)`);
    expect(r.rows).toEqual([]);
  });

  it('unit_id posé à l\'insertion et suivi au changement d\'unité', async () => {
    const c = await p().connect();
    try {
      await c.query('BEGIN');
      const id = (await c.query(`INSERT INTO ingredients (name, unit, unit_cost) VALUES ('Test M301', 'kg', 1) RETURNING id`)).rows[0].id;
      const kg = (await c.query(`SELECT id FROM v_units WHERE code = 'kg'`)).rows[0].id;
      const l = (await c.query(`SELECT id FROM v_units WHERE code = 'l'`)).rows[0].id;
      expect((await c.query(`SELECT unit_id FROM ingredients WHERE id = $1`, [id])).rows[0].unit_id).toBe(kg);
      await c.query(`UPDATE ingredients SET unit = 'l' WHERE id = $1`, [id]);
      expect((await c.query(`SELECT unit_id FROM ingredients WHERE id = $1`, [id])).rows[0].unit_id).toBe(l);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });

  it('aucune ligne de composition sans unité rattachée', async () => {
    const r = await p().query(
      `SELECT table_name, unit, COUNT(*)::int AS n FROM v_unit_unmatched
        WHERE table_name IN ('recipe_ingredients', 'recipe_components', 'recipe_format_components') GROUP BY 1, 2`);
    expect(r.rows).toEqual([]);
  });
});
