/**
 * G2-06 — allergènes des ingrédients : contient, traces, absent, non renseigné.
 *  - propositions : catégorie « Farines » → gluten ; nom « Poudre d'amande » → fruits à
 *    coque ; « Beurre de cacao », « Lait de coco » et « Sucre semoule » ne proposent rien ;
 *  - une fiche jamais vérifiée est « non renseignée », avec sa proposition, non écrite ;
 *  - enregistrer marque la fiche vérifiée ; listes vides = « aucun allergène » ;
 *  - refus : code hors référentiel, même allergène en « contient » et en « traces » ;
 *  - le compteur de qualité ne compte plus une fiche vérifiée ;
 *  - remontée : un produit dont la fiche utilise une base, elle-même faite d'une autre
 *    base, porte les allergènes des ingrédients du bas de la nomenclature.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, createProductWithRecipe, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Allergènes des ingrédients (G2-06)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let mod: typeof import('../../repositories/ingredient-allergens.repository.js');
  let quality: typeof import('../../repositories/master-data-quality.repository.js')['masterDataQualityRepository'];
  let fx: Fixtures;
  let farine: string, eau: string, amande: string;
  let productId: string;
  const bases: string[] = [];
  const p = () => testPool();
  const row = async (id: string) => (await mod.ingredientAllergensRepository.grid()).find(x => x.id === id)!;
  const missing = async () => (await quality.summary()).find(i => i.key === 'ingredients_sans_allergenes')!.toFix;

  beforeAll(async () => {
    repos = await importRepositories();
    mod = await import('../../repositories/ingredient-allergens.repository.js');
    ({ masterDataQualityRepository: quality } = await import('../../repositories/master-data-quality.repository.js'));
    fx = await createBaseFixtures();
    farine = await createIngredient(fx, { name: 'Farine T55 G206', unit: 'kg', unitCost: 5 });
    eau = await createIngredient(fx, { name: 'Eau G206', unit: 'l', unitCost: 0.1 });
    amande = await createIngredient(fx, { name: 'Poudre d\'amande G206', unit: 'kg', unitCost: 90 });
    // Produit → fiche → base « crème » → base « pâte » → farine ; l'amande est dans la crème.
    const base = async (name: string) => {
      const id = (await p().query(
        `INSERT INTO recipes (name, yield_quantity, yield_unit, is_base, mode_cout) VALUES ($1, 1, 'kg', true, 'ratio_poids') RETURNING id`, [`${name} ${RUN}`])).rows[0].id as string;
      bases.push(id);
      return id;
    };
    const pate = await base('Pâte G206'), creme = await base('Crème G206');
    await p().query(`INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ($1, $2, 1, 'kg')`, [pate, farine]);
    await p().query(`INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ($1, $2, 0.2, 'kg')`, [creme, amande]);
    await p().query(`INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ($1, $2, 1)`, [creme, pate]);
    const prod = await createProductWithRecipe(fx, { name: 'Tarte G206', price: 20, ingredients: [{ ingredientId: eau, quantity: 0.1, unit: 'l' }] });
    productId = prod.productId;
    await p().query(`INSERT INTO recipe_sub_recipes (recipe_id, sub_recipe_id, quantity) VALUES ($1, $2, 1)`, [prod.recipeId, creme]);
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM recipe_sub_recipes WHERE sub_recipe_id = ANY($1) OR recipe_id = ANY($1)`, [bases]).catch(() => undefined);
    await p().query(`DELETE FROM recipe_ingredients WHERE recipe_id = ANY($1)`, [bases]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await p().query(`DELETE FROM recipes WHERE id = ANY($1)`, [bases]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('propositions par catégorie et par nom, sans les noms trompeurs', () => {
    const { proposeAllergens } = mod;
    expect(proposeAllergens('T45', 'Farines')).toEqual(['gluten']);
    expect(proposeAllergens('Poudre d\'amande', 'Autre')).toEqual(['fruits_a_coque']);
    expect(proposeAllergens('Crème liquide 35 %', 'Crèmes (fraîche, liquide, épaisse)')).toEqual(['lait']);
    expect(proposeAllergens('Œufs frais', 'Oeufs')).toEqual(['oeufs']);
    expect(proposeAllergens('Beurre de cacao', 'Chocolat')).toEqual([]);
    expect(proposeAllergens('Lait de coco', 'Autre')).toEqual([]);
    expect(proposeAllergens('Noix de coco râpée', 'Autre')).toEqual([]);
    expect(proposeAllergens('Beurre de cacahuète', 'Autre')).toEqual(['arachides']);
    expect(proposeAllergens('Sucre semoule', 'Sucres')).toEqual([]);           // « semoule » désigne ici la mouture du sucre
    expect(proposeAllergens('Semoule fine', 'Autre')).toEqual(['gluten']);
    expect(proposeAllergens('Sel fin', 'Sel & Vinaigre')).toEqual([]);
  });

  it('fiche jamais vérifiée : non renseignée, proposition non écrite', async () => {
    expect(await row(farine)).toMatchObject({ reviewed: false, contains: [], traces: [], proposal: ['gluten'] });
    expect((await p().query(`SELECT allergens, allergens_reviewed_at FROM ingredients WHERE id = $1`, [farine])).rows[0])
      .toEqual({ allergens: [], allergens_reviewed_at: null });
    expect((await mod.ingredientAllergensRepository.grid({ onlyMissing: true })).some(x => x.id === farine)).toBe(true);
  });

  it('refus : code hors référentiel, allergène en double', async () => {
    const repo = mod.ingredientAllergensRepository;
    expect(await repo.save(farine, { contains: ['gluten', 'kryptonite'], traces: [] }, fx.userId)).toEqual({ error: 'Allergène(s) hors référentiel : kryptonite' });
    expect(await repo.save(farine, { contains: ['gluten'], traces: ['gluten'] }, fx.userId))
      .toEqual({ error: 'Un allergène est « contient » ou « traces », pas les deux : gluten' });
    expect(await repo.save('00000000-0000-0000-0000-000000000000', { contains: [], traces: [] }, fx.userId)).toEqual({ error: 'Ingrédient introuvable' });
    expect((await row(farine)).reviewed).toBe(false);
  });

  it('enregistrement : contient et traces, fiche vérifiée ; « aucun allergène » est un état', async () => {
    const repo = mod.ingredientAllergensRepository;
    const before = await missing();
    expect(await repo.save(farine, { contains: ['gluten'], traces: ['soja', 'lait'] }, fx.userId))
      .toMatchObject({ reviewed: true, contains: ['gluten'], traces: ['soja', 'lait'], proposal: [] });
    expect(await repo.save(eau, { contains: [], traces: [] }, fx.userId)).toMatchObject({ reviewed: true, contains: [], traces: [] });
    expect(await repo.save(amande, { contains: ['Amandes'], traces: [] }, fx.userId)).toMatchObject({ contains: ['fruits_a_coque'] });   // synonyme normalisé
    expect(before - await missing()).toBe(3);
    expect((await repo.grid({ onlyMissing: true })).some(x => [farine, eau, amande].includes(x.id))).toBe(false);
    const db = (await p().query(`SELECT allergens_reviewed_by FROM ingredients WHERE id = $1`, [eau])).rows[0];
    expect(db.allergens_reviewed_by).toBe(fx.userId);
  });

  it('remontée jusqu\'au produit fini à travers deux niveaux de bases', async () => {
    const r = (await p().query(`SELECT allergens FROM v_product_allergens WHERE product_id = $1`, [productId])).rows[0];
    expect(r.allergens).toEqual(['fruits_a_coque', 'gluten']);
  });
});
