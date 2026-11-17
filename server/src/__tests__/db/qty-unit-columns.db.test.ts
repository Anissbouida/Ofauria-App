/**
 * M3-04 — quantité + unité à côté des colonnes _g / _kg (mig 557).
 *  - écrire l'ancienne colonne (code actuel) remplit quantité + unité à l'identique ;
 *  - écrire quantité + unité (nouveau code) remplit l'ancienne colonne convertie :
 *    0,35 kg saisi → poids_cru_g = 350, l'unité saisie reste kg ;
 *  - une unité non convertible est refusée ;
 *  - après rattrapage, ancien et nouveau chemin donnent les mêmes valeurs converties.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool } from './helpers.js';

describe.skipIf(!hasTestDb)('Quantité + unité (M3-04)', () => {
  const p = () => testPool();
  afterAll(async () => { await closeTestPool(); });

  it('rattrapage : mêmes valeurs par l\'ancien et le nouveau chemin', async () => {
    const r = await p().query(
      `SELECT COUNT(*)::int AS n FROM recipe_formats
        WHERE poids_cru_g IS DISTINCT FROM fn_convert_qty(poids_cru_qty, (SELECT code FROM ref_entries WHERE id = poids_cru_unit_id), 'g')
           OR poids_cuit_g IS DISTINCT FROM fn_convert_qty(poids_cuit_qty, (SELECT code FROM ref_entries WHERE id = poids_cuit_unit_id), 'g')`);
    expect(r.rows[0].n).toBe(0);
  });

  it('double écriture dans les deux sens, unité saisie conservée', async () => {
    const c = await p().connect();
    try {
      await c.query('BEGIN');
      const recipe = (await c.query(`SELECT id FROM recipes LIMIT 1`)).rows[0].id;
      const fmt = (await c.query(`INSERT INTO recipe_formats (recipe_id, quantite_par_format) VALUES ($1, 500) RETURNING id`, [recipe])).rows[0].id;
      const unit = async (code: string) => (await c.query(`SELECT id FROM ref_entries WHERE table_id = 'units' AND code = $1`, [code])).rows[0].id;
      const row = async () => (await c.query(
        `SELECT poids_cru_g::float8 AS g, poids_cru_qty::float8 AS q, (SELECT code FROM ref_entries WHERE id = poids_cru_unit_id) AS u FROM recipe_formats WHERE id = $1`, [fmt])).rows[0];

      await c.query(`UPDATE recipe_formats SET poids_cru_g = 420 WHERE id = $1`, [fmt]);
      expect(await row()).toEqual({ g: 420, q: 420, u: 'g' });

      await c.query(`UPDATE recipe_formats SET poids_cru_qty = 0.35, poids_cru_unit_id = $2 WHERE id = $1`, [fmt, await unit('kg')]);
      expect(await row()).toEqual({ g: 350, q: 0.35, u: 'kg' });

      await c.query('SAVEPOINT s');
      await expect(c.query(`UPDATE recipe_formats SET poids_cru_qty = 2, poids_cru_unit_id = $2 WHERE id = $1`, [fmt, await unit('l')]))
        .rejects.toThrow(/non convertible/);
      await c.query('ROLLBACK TO SAVEPOINT s');
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});
