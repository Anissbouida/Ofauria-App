/**
 * Mig 652 : bases rendues « 1 unité » pour une fournée entière → rendement en grammes.
 *   - le rendement devient le poids de la fournée ;
 *   - une fiche qui emploie une fournée entière (1 unit) garde exactement son coût ;
 *   - Tarte aux amandes : 22 « unit » de crème d'amande et de pâte sucrée → 440 g et 990 g.
 * Déroulé dans une transaction annulée : la migration vise des noms de fiche précis.
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';
import { writeCompositionLines } from '../../repositories/composition-lines.helper.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIG = fs.readFileSync(path.join(here, '../../../migrations/652_rendement_bases_grammes.sql'), 'utf8');

describe.skipIf(!hasTestDb)('Mig 652 — rendement des bases en grammes', () => {
  afterAll(async () => { await closeTestPool(); });

  it('rendement au poids de la fournée, coût inchangé, Tarte aux amandes dosée par tartelette', async () => {
    const c = await testPool().connect();
    try {
      await c.query('BEGIN');
      const ing = async (name: string, cost: number) => (await c.query(
        `INSERT INTO ingredients (name, unit, unit_cost, category) VALUES ($1, 'kg', $2, 'autre') RETURNING id`, [`${name} ${RUN}`, cost])).rows[0].id as string;
      const recipe = async (name: string, base: boolean, yq: number, yu: string) => (await c.query(
        `INSERT INTO recipes (name, is_base, yield_quantity, yield_unit, mode_cout) VALUES ($1, $2, $3, $4, 'compose') RETURNING id`,
        [name, base, yq, yu])).rows[0].id as string;
      const cost = async (id: string) => Number((await c.query(`SELECT total_cost FROM v_recipe_total_cost_v2 WHERE id = $1`, [id])).rows[0].total_cost);
      const line = async (parent: string, base: string) => (await c.query(
        `SELECT fc.quantite::float8 AS q, fc.unite FROM recipe_format_components fc JOIN recipe_formats f ON f.id = fc.format_id
          WHERE f.recipe_id = $1 AND f.is_default AND fc.source_recipe_id = $2`, [parent, base])).rows[0];

      const beurre = await ing('M652 Beurre', 80); const sucre = await ing('M652 Sucre', 10); const eau = await ing('M652 Eau', 0);
      const amande = await recipe('Créme Amande', true, 1, 'unit');
      await writeCompositionLines(c, amande, { ingredients: [{ ingredientId: beurre, quantity: 172, unit: 'g' }, { ingredientId: sucre, quantity: 559, unit: 'g' }] });
      const pate = await recipe('Pate sucré', true, 1, 'unit');
      await writeCompositionLines(c, pate, { ingredients: [{ ingredientId: beurre, quantity: 320, unit: 'g' }, { ingredientId: sucre, quantity: 845.5, unit: 'g' }] });
      const confit = await recipe(`M652 Confit ${RUN}`, true, 1, 'unit');
      await writeCompositionLines(c, confit, { ingredients: [{ ingredientId: eau, quantity: 380, unit: 'ml' }, { ingredientId: sucre, quantity: 275, unit: 'g' }] });

      const tarte = await recipe('Tarte aux amandes', false, 22, 'unit');
      await writeCompositionLines(c, tarte, { subRecipes: [{ subRecipeId: amande, quantity: 22 }, { subRecipeId: pate, quantity: 22 }] });
      const entremets = await recipe(`M652 Entremets ${RUN}`, false, 1, 'unit');
      await writeCompositionLines(c, entremets, { subRecipes: [{ subRecipeId: confit, quantity: 1 }] });
      const avant = await cost(entremets);

      await c.query(MIG);

      const y = async (id: string) => (await c.query(`SELECT yield_quantity::float8 AS q, yield_unit AS u FROM recipes WHERE id = $1`, [id])).rows[0];
      expect(await y(amande)).toEqual({ q: 731, u: 'g' });
      expect(await y(pate)).toEqual({ q: 1165.5, u: 'g' });
      expect(await y(confit)).toEqual({ q: 655, u: 'g' });
      expect(await line(tarte, amande)).toEqual({ q: 440, unite: 'g' });
      expect(await line(tarte, pate)).toEqual({ q: 990, unite: 'g' });
      expect(await line(entremets, confit)).toEqual({ q: 655, unite: 'g' });
      expect(await cost(entremets)).toBeCloseTo(avant, 6);
      // Tarte : 440 g sur 731 g de crème d'amande + 990 g sur 1 165,5 g de pâte (au lieu de 22 fournées chacune).
      const attendu = (440 / 731) * (0.172 * 80 + 0.559 * 10) + (990 / 1165.5) * (0.32 * 80 + 0.8455 * 10);
      expect(await cost(tarte)).toBeCloseTo(attendu, 4);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});
