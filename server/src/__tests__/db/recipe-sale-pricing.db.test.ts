/**
 * Mig 614 (scénario 1, constat 29) — prix d'un produit fabriqué = prix de SA fiche.
 *  - à la pièce : coût complet (matière + structure) et prix de fn_recipe_cost, pas la
 *    matière seule ni la fournée entière ;
 *  - au poids, format au kilo (mig 613) : coût et prix au kilo de la fiche ;
 *  - au poids, format en pièces : coût de la fournée ÷ poids brut de la composition ;
 *  - syncProductPrice (cascade coût matière / base) écrit ces mêmes valeurs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, createProductWithRecipe, cleanupFixtures, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Prix de vente depuis la fiche (mig 614)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let recipeRepository: typeof import('../../repositories/recipe.repository.js')['recipeRepository'];
  let fx: Fixtures;
  let productId: string, recipeId: string, formatId: string;
  const p = () => testPool();
  const pricing = async () => (await p().query(`SELECT * FROM fn_recipe_sale_pricing($1)`, [recipeId])).rows[0];
  const cost = async () => (await p().query(`SELECT * FROM fn_recipe_cost($1, $2)`, [recipeId, formatId])).rows[0];
  const product = async () => (await p().query(`SELECT price, price_per_kg, cost_price FROM products WHERE id = $1`, [productId])).rows[0];
  const sync = () => recipeRepository.syncProductPrice(repos.db, productId, 0, 1, 'unit', null, 3);

  beforeAll(async () => {
    repos = await importRepositories();
    ({ recipeRepository } = await import('../../repositories/recipe.repository.js'));
    fx = await createBaseFixtures();
    const farine = await createIngredient(fx, { name: 'Farine 614', unit: 'kg', unitCost: 5.5 });
    const sel = await createIngredient(fx, { name: 'Sel 614', unit: 'kg', unitCost: 2 });
    ({ productId, recipeId } = await createProductWithRecipe(fx, { name: 'Baguette 614', price: 1, ingredients: [] }));
    await p().query(
      `UPDATE recipes SET margin_multiplier = 3, taux_frais_structure_pct = 15, taux_main_oeuvre_dh_h = 0,
              cout_energie_fournee = 0, compo_par_piece = false WHERE id = $1`, [recipeId]);
    formatId = (await p().query(
      `INSERT INTO recipe_formats (recipe_id, quantite_par_format, nb_par_defaut, is_active, is_default)
       VALUES ($1, 1, 100, true, true) RETURNING id`, [recipeId])).rows[0].id;
    // 15 kg × 5,5 + 300 g × 2 = 83,10 DH la fournée de 100 pièces, 15,3 kg bruts.
    await p().query(
      `INSERT INTO recipe_format_components (format_id, source_ingredient_id, quantite, unite, ordre)
       VALUES ($1, $2, 15, 'kg', 0), ($1, $3, 300, 'g', 1)`, [formatId, farine, sel]);
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('à la pièce : coût complet et prix de la fiche', async () => {
    const c = await cost();
    expect(Number(c.complet_u)).toBeCloseTo(0.831 * 1.15, 4);
    const sp = await pricing();
    expect(Number(sp.cout_piece)).toBeCloseTo(Number(c.complet_u), 6);
    expect(Number(sp.prix_piece)).toBeCloseTo(Number(c.prix_u), 6);

    await sync();
    const pr = await product();
    // products.cost_price est stocké à 2 décimales.
    expect(Number(pr.cost_price)).toBeCloseTo(0.96, 2);
    expect(Number(pr.price)).toBeCloseTo(Number(c.prix_u), 2);
  });

  it('au poids, format en pièces : coût de la fournée ÷ poids brut', async () => {
    const sp = await pricing();
    expect(Number(sp.poids_brut_kg)).toBeCloseTo(15.3, 6);
    expect(Number(sp.cout_kg)).toBeCloseTo((83.1 * 1.15) / 15.3, 4);
  });

  it('au poids, format au kilo : coût et prix au kilo de la fiche, écrits par la synchro', async () => {
    await p().query(`UPDATE recipe_formats SET rendement_unite = 'kg', rendement_kg = 25 WHERE id = $1`, [formatId]);
    await p().query(`UPDATE products SET sale_unit = 'weight' WHERE id = $1`, [productId]);
    const c = await cost();
    expect(Number(c.complet_u)).toBeCloseTo((83.1 * 1.15) / 25, 4);
    const sp = await pricing();
    expect(Number(sp.cout_kg)).toBeCloseTo(Number(c.complet_u), 6);
    expect(Number(sp.prix_kg)).toBeCloseTo(Number(c.prix_u), 6);
    // Pièce d'un format au kilo : fournée (25 kg) ÷ 100 pièces.
    expect(Number(sp.cout_piece)).toBeCloseTo(Number(c.complet_u) * 25 / 100, 6);

    await sync();
    const pr = await product();
    expect(Number(pr.cost_price)).toBeCloseTo(Number(c.complet_u), 2);
    expect(Number(pr.price)).toBeCloseTo(Number(c.prix_u), 2);
    expect(Number(pr.price_per_kg)).toBeCloseTo(Number(c.prix_u), 2);
  });
});
