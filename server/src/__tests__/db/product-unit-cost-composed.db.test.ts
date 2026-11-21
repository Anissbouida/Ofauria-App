/**
 * Scénario 1, constat 115 — coût matière d'un produit composé de préparations de base
 * (mig 624) : v_product_unit_cost suit fn_recipe_cost, plus l'ancien prorata au poids qui
 * divisait le coût d'un croissant par 40.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Coût matière d\'un produit composé (constat 115)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fx: Fixtures;
  const recipeIds: string[] = [];
  let productId = '', baseId = '', prodRecipeId = '', prodFormatId = '';
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    fx = await createBaseFixtures();
    const beurre = await createIngredient(fx, { name: 'Beurre C115', unit: 'kg', unitCost: 95 });
    const farine = await createIngredient(fx, { name: 'Farine C115', unit: 'kg', unitCost: 6 });
    // Pâte feuilletée : 1 kg de beurre + 2 kg de farine = 101 DH pour 3 kg (préparation de base au kilo).
    baseId = (await p().query(`INSERT INTO recipes (name, is_base, yield_quantity, yield_unit, mode_cout) VALUES ($1, true, 3, 'kg', 'compose') RETURNING id`, [`Pâte C115 ${RUN}`])).rows[0].id;
    recipeIds.push(baseId);
    const bf = (await p().query(
      `INSERT INTO recipe_formats (recipe_id, quantite_par_format, nb_par_defaut, is_default, rendement_unite, rendement_kg) VALUES ($1, 3000, 1, true, 'kg', 3) RETURNING id`, [baseId])).rows[0].id;
    await p().query(
      `INSERT INTO recipe_format_components (format_id, source_ingredient_id, quantite, unite, ordre) VALUES ($1, $2, 1, 'kg', 0), ($1, $3, 2, 'kg', 1)`,
      [bf, beurre, farine]);
    // Croissant : 60 g de pâte par pièce, composition par pièce.
    productId = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1, $2, 5.5) RETURNING id`, [`Croissant C115 ${RUN}`, `croissant-c115-${RUN}`])).rows[0].id;
    prodRecipeId = (await p().query(
      `INSERT INTO recipes (name, product_id, compo_par_piece, mode_cout) VALUES ($1, $2, true, 'compose') RETURNING id`, [`Croissant C115 ${RUN}`, productId])).rows[0].id;
    recipeIds.push(prodRecipeId);
    prodFormatId = (await p().query(
      `INSERT INTO recipe_formats (recipe_id, quantite_par_format, nb_par_defaut, is_default) VALUES ($1, 60, 40, true) RETURNING id`, [prodRecipeId])).rows[0].id;
    await p().query(
      `INSERT INTO recipe_format_components (format_id, source_recipe_id, quantite, unite, ordre) VALUES ($1, $2, 60, 'g', 0)`,
      [prodFormatId, baseId]);
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM recipe_format_components WHERE format_id IN (SELECT id FROM recipe_formats WHERE recipe_id = ANY($1::uuid[]))`, [recipeIds]).catch(() => undefined);
    await p().query(`DELETE FROM recipe_formats WHERE recipe_id = ANY($1::uuid[])`, [recipeIds]).catch(() => undefined);
    await p().query(`DELETE FROM recipes WHERE id = ANY($1::uuid[])`, [recipeIds]).catch(() => undefined);
    await p().query(`DELETE FROM products WHERE id = $1`, [productId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('le coût matière du produit est celui de fn_recipe_cost (60 g de pâte à 101 DH les 3 kg, pas ~0,05 DH)', async () => {
    const fn = Number((await p().query(`SELECT matiere_u FROM fn_recipe_cost($1, $2)`, [prodRecipeId, prodFormatId])).rows[0].matiere_u);
    // 60 g de pâte à 101 DH les 3 kg = 2,02 DH avant pertes : l'ancien prorata au poids rendait ~0,05.
    expect(fn).toBeGreaterThan(60 * 101 / 3000 - 0.01);
    expect(fn).toBeLessThan(2.5);
    const v = (await p().query(`SELECT unit_cost, cost_source FROM v_product_unit_cost WHERE product_id = $1`, [productId])).rows[0];
    expect(v.cost_source).toBe('format');
    expect(Number(v.unit_cost)).toBeCloseTo(fn, 4);
  });
});
