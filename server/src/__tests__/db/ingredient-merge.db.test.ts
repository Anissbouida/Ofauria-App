/**
 * G2-03 — fusion de deux fiches du même ingrédient.
 * Beurre A (10 DH/kg, 30 kg en stock) fusionné dans Beurre B (12 DH/kg, 10 kg) :
 *  - l'aperçu annonce l'impact sans rien écrire ;
 *  - les lignes de recette sont repointées ; dans une recette qui avait les deux fiches
 *    dans la même unité, les quantités s'additionnent ;
 *  - les lots, les mouvements et le stock passent sur la fiche gardée (40 kg) ;
 *  - le coût devient la moyenne pondérée : (30 × 10 + 10 × 12) / 40 = 10,50 ;
 *  - la fiche en trop n'existe plus, elle est archivée entière dans le journal ;
 *  - unités différentes, fiche identique, fiche inconnue : refus, rien n'est modifié.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, createLot, createProductWithRecipe, cleanupFixtures, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Fusion d\'ingrédients en double (G2-03)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let merge: typeof import('../../repositories/ingredient-merge.repository.js')['ingredientMergeRepository'];
  let fx: Fixtures;
  let a: string, b: string, piece: string;
  let recipeBoth: string, recipeOnlyA: string;
  const p = () => testPool();
  const stock = async (id: string) => Number((await p().query(
    `SELECT COALESCE(SUM(current_quantity), 0) AS q FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [id, fx.storeId])).rows[0].q);

  beforeAll(async () => {
    repos = await importRepositories();
    ({ ingredientMergeRepository: merge } = await import('../../repositories/ingredient-merge.repository.js'));
    fx = await createBaseFixtures();
    a = await createIngredient(fx, { name: 'Beurre A G203', unit: 'kg', unitCost: 10 });
    b = await createIngredient(fx, { name: 'Beurre B G203', unit: 'kg', unitCost: 12 });
    piece = await createIngredient(fx, { name: 'Beurre plaquette G203', unit: 'unit', unitCost: 15 });
    await createLot(fx, { ingredientId: a, lotNumber: 'A1', pesage: 10, economat: 20, expiresInDays: 30, unitCost: 10 });
    await createLot(fx, { ingredientId: b, lotNumber: 'B1', pesage: 10, expiresInDays: 30, unitCost: 12 });
    await p().query(`UPDATE inventory SET minimum_threshold = 5 WHERE ingredient_id = $1`, [a]);
    await p().query(
      `INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, store_id) VALUES ($1, 'adjustment', -1, $2)`, [a, fx.storeId]);
    recipeBoth = (await createProductWithRecipe(fx, { name: 'Brioche G203', price: 10, ingredients: [
      { ingredientId: a, quantity: 0.2, unit: 'kg' }, { ingredientId: b, quantity: 0.3, unit: 'kg' }, { ingredientId: a, quantity: 50, unit: 'g' },
    ] })).recipeId;
    recipeOnlyA = (await createProductWithRecipe(fx, { name: 'Sablé G203', price: 5, ingredients: [{ ingredientId: a, quantity: 0.1, unit: 'kg' }] })).recipeId;
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM ingredient_merges WHERE target_id = ANY($1) OR source_id = ANY($1)`, [[a, b, piece]]).catch(() => undefined);
    await p().query(`DELETE FROM inventory_transactions WHERE ingredient_id = ANY($1)`, [[a, b, piece]]).catch(() => undefined);
    await p().query(`DELETE FROM ingredient_lots WHERE ingredient_id = ANY($1)`, [[a, b, piece]]).catch(() => undefined);
    await p().query(`DELETE FROM inventory WHERE ingredient_id = ANY($1)`, [[a, b, piece]]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('refus : unités différentes, même fiche, fiche inconnue — rien n\'est modifié', async () => {
    const mixed = await merge.merge(piece, b, fx.userId);
    expect('error' in mixed && mixed.error).toMatch(/n'ont pas la même unité/);
    expect(await merge.merge(a, a, fx.userId)).toEqual({ error: 'Choisissez deux fiches différentes' });
    expect(await merge.merge('00000000-0000-0000-0000-000000000000', b, fx.userId)).toEqual({ error: 'Fiche à fusionner introuvable' });
    const preview = await merge.preview(piece, b);
    expect('blocker' in preview && preview.blocker).toMatch(/même unité/);
    expect((await p().query(`SELECT COUNT(*)::int AS n FROM ingredients WHERE id = ANY($1)`, [[a, b, piece]])).rows[0].n).toBe(3);
  });

  it('aperçu : impact annoncé, rien d\'écrit', async () => {
    const pv = await merge.preview(a, b);
    if ('error' in pv) throw new Error(pv.error);
    expect(pv.blocker).toBeNull();
    expect(pv.impact.recipes).toBe(2);
    expect(pv.impact.lots).toBe(1);
    expect(pv.impact.tables.recipe_ingredients).toBe(3);
    expect(pv.impact.tables.inventory_transactions).toBe(1);
    expect(pv.impact.stock).toEqual([expect.objectContaining({ storeId: fx.storeId, source: 30, target: 10 })]);
    expect(pv.impact).toMatchObject({ unitCostBefore: 12, unitCostAfter: 10.5 });
    expect(await stock(a)).toBe(30);
  });

  it('fusion : recettes, lots, mouvements et stock passent sur la fiche gardée ; coût moyen pondéré', async () => {
    const out = await merge.merge(a, b, fx.userId);
    if ('error' in out) throw new Error(out.error);

    // La fiche en trop n'existe plus ; plus aucune référence.
    expect((await p().query(`SELECT 1 FROM ingredients WHERE id = $1`, [a])).rows).toHaveLength(0);
    for (const [table, col] of [['recipe_ingredients', 'ingredient_id'], ['ingredient_lots', 'ingredient_id'], ['inventory', 'ingredient_id'], ['inventory_transactions', 'ingredient_id']]) {
      expect((await p().query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${col} = $1`, [a])).rows[0].n).toBe(0);
    }

    // Recette aux deux fiches : 0,2 kg + 0,3 kg = 0,5 kg sur une ligne ; la ligne en grammes est repointée telle quelle.
    const both = (await p().query(
      `SELECT quantity::float AS q, unit FROM recipe_ingredients WHERE recipe_id = $1 AND ingredient_id = $2 ORDER BY unit`, [recipeBoth, b])).rows;
    expect(both).toEqual([{ q: 50, unit: 'g' }, { q: 0.5, unit: 'kg' }]);
    expect((await p().query(`SELECT quantity::float AS q FROM recipe_ingredients WHERE recipe_id = $1 AND ingredient_id = $2`, [recipeOnlyA, b])).rows).toEqual([{ q: 0.1 }]);

    // Stock : 30 + 10 = 40 kg, seuil le plus haut ; les deux lots sont sur la fiche gardée.
    expect(await stock(b)).toBe(40);
    expect(Number((await p().query(`SELECT minimum_threshold FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [b, fx.storeId])).rows[0].minimum_threshold)).toBe(5);
    expect((await p().query(`SELECT COUNT(*)::int AS n FROM ingredient_lots WHERE ingredient_id = $1`, [b])).rows[0].n).toBe(2);

    // Coût moyen pondéré.
    expect(Number((await p().query(`SELECT unit_cost FROM ingredients WHERE id = $1`, [b])).rows[0].unit_cost)).toBe(10.5);

    // Journal : la fiche retirée est archivée entière.
    const j = (await p().query(`SELECT * FROM ingredient_merges WHERE id = $1`, [out.mergeId])).rows[0];
    expect(j).toMatchObject({ source_id: a, target_id: b, merged_by: fx.userId });
    expect(j.source_snapshot).toMatchObject({ id: a, unit: 'kg' });
    expect(Number(j.unit_cost_before)).toBe(12);
    expect(Number(j.unit_cost_after)).toBe(10.5);
    expect((await merge.history(5)).some(h => h.id === out.mergeId && h.source_name.startsWith('Beurre A'))).toBe(true);
  }, 60_000);
});
