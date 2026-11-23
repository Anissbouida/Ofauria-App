/**
 * G2-09 — données de l'étiquette réglementaire.
 * Tarte = 0,1 l d'eau + 1 kg de crème ; crème (1 kg) = 0,2 kg de poudre d'amande + 1 kg de
 * pâte ; pâte (1 kg) = 1 kg de farine. Deux niveaux de semi-finis.
 *  - la liste contient les ingrédients de base (pas les semi-finis), par poids décroissant :
 *    farine (1 kg), amande (0,2 kg), eau (0,1 kg) ;
 *  - tant qu'un ingrédient n'a pas ses allergènes renseignés, l'étiquette n'est pas imprimable ;
 *  - une fois renseignés : ingrédients à allergène en majuscules, traces à part (sans
 *    répéter un allergène déjà « contient ») ;
 *  - poids net tiré du poids cuit du format, mentions du produit, avertissements ;
 *  - produit sans fiche technique : non imprimable ; produit inconnu : null.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, createProductWithRecipe, cleanupFixtures, RUN, setComposition, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Données de l\'étiquette réglementaire (G2-09)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let label: typeof import('../../repositories/product-label.repository.js')['productLabelRepository'];
  let allergens: typeof import('../../repositories/ingredient-allergens.repository.js')['ingredientAllergensRepository'];
  let fx: Fixtures;
  let farine: string, eau: string, amande: string;
  let productId: string, recipeId: string, formatId: string, bareProductId: string;
  const bases: string[] = [];
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    ({ productLabelRepository: label } = await import('../../repositories/product-label.repository.js'));
    ({ ingredientAllergensRepository: allergens } = await import('../../repositories/ingredient-allergens.repository.js'));
    fx = await createBaseFixtures();
    farine = await createIngredient(fx, { name: 'Farine de blé G209', unit: 'kg', unitCost: 5 });
    eau = await createIngredient(fx, { name: 'Eau G209', unit: 'l', unitCost: 0.1, densite: 1 });
    amande = await createIngredient(fx, { name: 'Poudre d\'amande G209', unit: 'kg', unitCost: 90 });
    const base = async (name: string) => {
      const id = (await p().query(
        `INSERT INTO recipes (name, yield_quantity, yield_unit, is_base, mode_cout) VALUES ($1, 1, 'kg', true, 'ratio_poids') RETURNING id`, [`${name} ${RUN}`])).rows[0].id as string;
      bases.push(id);
      return id;
    };
    const pate = await base('Pâte G209'), creme = await base('Crème G209');
    await setComposition(pate, { ingredients: [{ ingredientId: farine, quantity: 1, unit: 'kg' }] });
    await setComposition(creme, { ingredients: [{ ingredientId: amande, quantity: 0.2, unit: 'kg' }], subRecipes: [{ subRecipeId: pate, quantity: 1 }] });
    ({ productId, recipeId } = await createProductWithRecipe(fx, { name: 'Tarte G209', price: 20, shelfLifeDays: 2, ingredients: [] }));
    // Pas 2b-1 : composition dans la nomenclature du format par défaut, qui porte aussi les poids.
    formatId = (await setComposition(recipeId, { ingredients: [{ ingredientId: eau, quantity: 0.1, unit: 'l' }], subRecipes: [{ subRecipeId: creme, quantity: 1 }] }))!;
    await p().query(`UPDATE recipe_formats SET poids_cru_g = 500, poids_cuit_g = 450 WHERE id = $1`, [formatId]);
    bareProductId = (await p().query(
      `INSERT INTO products (name, slug, price, sale_type) VALUES ($1, $2, 1, 'jour') RETURNING id`, [`Nu G209 ${RUN}`, `nu-g209-${RUN}`])).rows[0].id;
    fx.ids.products.push(bareProductId);
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM recipe_formats WHERE id = $1`, [formatId]).catch(() => undefined);
    await p().query(`DELETE FROM recipe_format_components WHERE format_id IN (SELECT id FROM recipe_formats WHERE recipe_id = ANY($1))`, [bases]).catch(() => undefined);
    await p().query(`DELETE FROM recipe_formats WHERE recipe_id = ANY($1)`, [bases]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await p().query(`DELETE FROM recipes WHERE id = ANY($1)`, [bases]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('nomenclature éclatée sur deux niveaux, par poids décroissant ; non imprimable sans allergènes renseignés', async () => {
    const d = (await label.labelData(productId))!;
    expect(d.ingredients.map(i => [i.name.replace(` ${RUN}`, ''), i.weightKg])).toEqual([
      ['Farine de blé G209', 1], ['Poudre d\'amande G209', 0.2], ['Eau G209', 0.1],
    ]);
    expect(d.ingredients.map(i => i.sharePct)).toEqual([76.9, 15.4, 7.7]);
    expect(d.printable).toBe(false);
    expect(d.blockers).toHaveLength(1);
    expect(d.blockers[0]).toMatch(/^Allergènes non renseignés pour 3 ingrédients/);
  });

  it('allergènes renseignés : imprimable, allergènes en majuscules, traces à part', async () => {
    await allergens.save(farine, { contains: ['gluten'], traces: ['soja'] }, fx.userId);
    await allergens.save(amande, { contains: ['fruits_a_coque'], traces: ['gluten', 'lait'] }, fx.userId);
    await allergens.save(eau, { contains: [], traces: [] }, fx.userId);
    const d = (await label.labelData(productId))!;
    expect(d.printable).toBe(true);
    expect(d.blockers).toEqual([]);
    expect(d.allergens).toEqual({ contains: ['gluten', 'fruits_a_coque'], traces: ['soja', 'lait'] });   // gluten déjà « contient » : pas répété en traces
    expect(d.ingredientsText).toBe(`Ingrédients : FARINE DE BLÉ G209 ${RUN.toLocaleUpperCase('fr')}, POUDRE D'AMANDE G209 ${RUN.toLocaleUpperCase('fr')}, eau g209 ${RUN.toLocaleLowerCase('fr')}.`);
    expect(d.tracesText).toBe('Peut contenir des traces de : soja, lait.');
  });

  it('mentions du produit, poids net du format, avertissements', async () => {
    let d = (await label.labelData(productId))!;
    expect(d.product).toMatchObject({ netWeightG: 450, shelfLifeDays: 2, storageConditions: null, mentions: null });
    expect(d.product.legalName).toBe(d.product.name);   // à défaut de dénomination légale
    expect(d.warnings).toEqual(['Dénomination légale non renseignée : le nom du produit est utilisé', 'Conditions de conservation non renseignées']);

    expect(await label.saveFields(productId, { legalName: ' Tarte aux amandes ', storageConditions: 'À conserver entre 0 et 4 °C', labelMentions: '' })).toBe(true);
    d = (await label.labelData(productId))!;
    expect(d.product).toMatchObject({ legalName: 'Tarte aux amandes', storageConditions: 'À conserver entre 0 et 4 °C', mentions: null });
    expect(d.warnings).toEqual([]);
    expect(await label.saveFields('00000000-0000-0000-0000-000000000000', { legalName: 'x' })).toBe(false);
  });

  it('produit sans fiche technique : non imprimable ; produit inconnu : null', async () => {
    const d = (await label.labelData(bareProductId))!;
    expect(d.printable).toBe(false);
    expect(d.blockers[0]).toMatch(/n'a pas de fiche technique/);
    expect(d.ingredients).toEqual([]);
    expect(await label.labelData('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});
