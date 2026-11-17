/**
 * M3-03 — fn_convert_factor / fn_convert_qty et vues de coût _v2 (mig 556).
 *  - chaque vue _v2 rend exactement les lignes de la vue d'origine (zéro écart) ;
 *  - une unité ajoutée au référentiel se convertit (mètre → centimètre) ;
 *  - une conversion impossible rend NULL, là où fn_unit_conv rendait 1 ;
 *  - entre dimensions, la conversion propre à l'article s'applique (pièce → kg).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool } from './helpers.js';

describe.skipIf(!hasTestDb)('Conversion pilotée par les données et vues _v2 (M3-03)', () => {
  const p = () => testPool();
  afterAll(async () => { await closeTestPool(); });

  it('chaque vue _v2 égale la vue d\'origine', async () => {
    const { UNIT_VIEWS, diffQuery } = await import('../../../scripts/compare-unit-views.js');
    for (const v of UNIT_VIEWS) {
      expect((await p().query(await diffQuery(p(), v, `${v}_v2`))).rows[0].n, v).toBe(0);
      expect((await p().query(await diffQuery(p(), `${v}_v2`, v))).rows[0].n, `${v}_v2`).toBe(0);
    }
  });

  it('mètre → centimètre, conversion impossible → NULL, pièce → kg par l\'article', async () => {
    const c = await p().connect();
    const f = async (sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows[0].f;
    try {
      await c.query('BEGIN');
      await c.query(`INSERT INTO ref_entries (table_id, code, label, metadata) VALUES ('units', 'cm', 'Centimètre', '{"category":"length","to_base":0.01}')`);
      expect(Number(await f(`SELECT fn_convert_factor('m', 'cm') AS f`))).toBe(100);
      expect(Number(await f(`SELECT fn_convert_qty(2.5, 'm', 'cm') AS f`))).toBe(250);

      expect(await f(`SELECT fn_convert_factor('unit', 'g') AS f`)).toBeNull();
      expect(Number(await f(`SELECT fn_unit_conv('unit', 'g') AS f`))).toBe(1);

      const id = (await c.query(`INSERT INTO ingredients (name, unit, unit_cost, poids_piece_kg) VALUES ('Œuf M303', 'unit', 1.5, 0.06) RETURNING id`)).rows[0].id;
      expect(Number(await f(`SELECT fn_convert_qty(10, 'unit', 'g', 'ingredient', $1) AS f`, [id]))).toBeCloseTo(600, 6);
      expect(Number(await f(`SELECT fn_ingredient_weight_kg_v2($1, 10) AS f`, [id]))).toBeCloseTo(0.6, 6);
      expect(Number(await f(`SELECT fn_ingredient_weight_kg($1, 10) AS f`, [id]))).toBeCloseTo(0.6, 6);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});
