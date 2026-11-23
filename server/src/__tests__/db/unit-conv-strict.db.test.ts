/**
 * G0-26 — conversion d'unité stricte (mig 529).
 * fn_unit_conv rend 1 pour une conversion inconnue ; fn_unit_conv_strict rend NULL, et
 * v_impossible_unit_conversions liste les lignes de fiche concernées.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, createBaseFixtures, createIngredient, createProductWithRecipe, cleanupFixtures, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Conversion d\'unité stricte (G0-26)', () => {
  let fx: Fixtures;
  let farineId: string, huileId: string, recipeId: string;
  const p = () => testPool();
  const conv = async (from: string | null, to: string | null, densite: number | null = null) => {
    const v = (await p().query(`SELECT fn_unit_conv_strict($1, $2, $3::numeric) AS v`, [from, to, densite])).rows[0].v;
    return v === null ? null : parseFloat(v);
  };
  const issues = async () => (await p().query(
    // Pas 2b-1 : la fiche vit dans la nomenclature du format par défaut ET dans son miroir
    // (recipe_components) ; la vue lit les deux, une ligne y figure donc une fois par source.
    `SELECT DISTINCT ingredient_id, line_unit, stock_unit FROM v_impossible_unit_conversions WHERE recipe_id = $1 ORDER BY line_unit`, [recipeId])).rows;

  beforeAll(async () => {
    fx = await createBaseFixtures();
    farineId = await createIngredient(fx, { name: 'Farine G026', unit: 'kg', unitCost: 10 });
    huileId = await createIngredient(fx, { name: 'Huile G026', unit: 'l', unitCost: 17 });
    ({ recipeId } = await createProductWithRecipe(fx, {
      name: 'Pain G026', price: 3,
      ingredients: [
        { ingredientId: farineId, quantity: 500, unit: 'g' },      // masse -> masse : convertible
        { ingredientId: farineId, quantity: 2, unit: 'unit' },     // pièce -> kg : impossible
        { ingredientId: huileId, quantity: 120, unit: 'g' },       // masse -> volume sans densité : impossible
      ],
    }));
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx);
    await closeTestPool();
  });

  it('connue : même unité, masse, volume, poids <-> volume avec densité', async () => {
    expect(await conv('kg', 'g')).toBe(1000);
    expect(await conv('g', 'kg')).toBe(0.001);
    expect(await conv('cl', 'ml')).toBe(10);
    expect(await conv('m', 'm')).toBe(1);
    expect(await conv('ml', 'g', 0.92)).toBeCloseTo(0.92, 6);
  });

  it('inconnue : NULL, là où fn_unit_conv rend 1', async () => {
    expect(await conv('unit', 'kg')).toBeNull();
    expect(await conv('m', 'g')).toBeNull();
    expect(await conv('g', 'ml')).toBeNull();              // poids -> volume sans densité
    expect(await conv(null, 'g')).toBeNull();
    expect(parseFloat((await p().query(`SELECT fn_unit_conv('unit', 'kg') AS v`)).rows[0].v)).toBe(1);   // inchangée
  });

  it('la vue liste les lignes de fiche impossibles, et seulement elles', async () => {
    expect(await issues()).toEqual([
      { ingredient_id: huileId, line_unit: 'g', stock_unit: 'l' },
      { ingredient_id: farineId, line_unit: 'unit', stock_unit: 'kg' },
    ]);
  });

  it('renseigner la densité fait sortir la ligne de la liste', async () => {
    await p().query(`UPDATE ingredients SET densite_kg_l = 0.92 WHERE id = $1`, [huileId]);
    expect(await issues()).toEqual([{ ingredient_id: farineId, line_unit: 'unit', stock_unit: 'kg' }]);
  });
});
