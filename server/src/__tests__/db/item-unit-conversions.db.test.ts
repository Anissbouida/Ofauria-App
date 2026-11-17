/**
 * M3-02 — conversions propres à l'article (mig 555).
 *  - un ingrédient avec densité donne le même facteur litre → kilo par l'ancienne colonne
 *    (fn_unit_conv) et par la nouvelle table ; la ligne suit la colonne quand elle change ;
 *  - le contenant devient « 1 sac = 25 kg » ;
 *  - une conversion inverse incohérente est refusée ; une conversion saisie s'ajoute.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool } from './helpers.js';

describe.skipIf(!hasTestDb)('Conversions propres à l\'article (M3-02)', () => {
  const p = () => testPool();
  afterAll(async () => { await closeTestPool(); });

  it('densité, contenant, cohérence, saisie', async () => {
    const c = await p().connect();
    const factor = async (id: string, origin: string) =>
      (await c.query(`SELECT factor::float8 AS f FROM item_unit_conversions WHERE item_kind = 'ingredient' AND item_id = $1 AND origin = $2`, [id, origin])).rows[0]?.f;
    try {
      await c.query('BEGIN');
      const sac = (await c.query(`SELECT id FROM ref_entries WHERE table_id = 'container_types' AND code = 'sac'`)).rows[0]?.id
        ?? (await c.query(`INSERT INTO ref_entries (table_id, code, label) VALUES ('container_types', 'sac_m302', 'Sac') RETURNING id`)).rows[0].id;
      const id = (await c.query(
        `INSERT INTO ingredients (name, unit, unit_cost, densite_kg_l, container_type_id, container_size)
         VALUES ('Huile M302', 'kg', 20, 0.92, $1, 25) RETURNING id`, [sac])).rows[0].id;
      const legacy = Number((await c.query(`SELECT fn_unit_conv('l', 'kg', 0.92) AS f`)).rows[0].f);
      expect(await factor(id, 'densite')).toBeCloseTo(legacy, 10);
      expect(await factor(id, 'contenant')).toBe(25);

      await c.query(`UPDATE ingredients SET densite_kg_l = 0.95 WHERE id = $1`, [id]);
      expect(await factor(id, 'densite')).toBeCloseTo(0.95, 10);

      const u = async (code: string) => (await c.query(`SELECT id FROM ref_entries WHERE table_id = 'units' AND code = $1`, [code])).rows[0].id;
      await c.query('SAVEPOINT s');
      await expect(c.query(`INSERT INTO item_unit_conversions (item_kind, item_id, from_unit_id, to_unit_id, factor) VALUES ('ingredient', $1, $2, $3, 2)`,
        [id, await u('kg'), await u('l')])).rejects.toThrow(/CONVERSION_INCOHERENTE/);
      await c.query('ROLLBACK TO SAVEPOINT s');
      // L'inverse cohérent (1 kg = 1/0,95 l) est accepté.
      await c.query(`INSERT INTO item_unit_conversions (item_kind, item_id, from_unit_id, to_unit_id, factor) VALUES ('ingredient', $1, $2, $3, $4)`,
        [id, await u('kg'), await u('l'), 1 / 0.95]);
      expect(await factor(id, 'saisie')).toBeCloseTo(1 / 0.95, 6);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});
