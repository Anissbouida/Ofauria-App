/**
 * Mig 661 — coûts standard validés (le coût sort de la fiche technique).
 *
 *  - sans validation, l'article est « calculé, à valider » ;
 *  - valider fige le calcul du jour : il devient le coût de référence (situation « validé ») ;
 *  - un prix de matière qui change rend le coût validé « à recalculer », avec l'écart ;
 *  - valider à nouveau remplace l'ancien coût de référence, qui reste dans l'historique ;
 *  - un seul coût de référence en vigueur par fiche, format et établissement.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, createBaseFixtures, createIngredient, createProductWithRecipe, cleanupFixtures, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Coûts standard validés (mig 661)', () => {
  let repo: typeof import('../../repositories/standard-cost.repository.js')['standardCostRepository'];
  let fx: Fixtures;
  let ingredientId: string, recipeId: string;
  const p = () => testPool();

  beforeAll(async () => {
    ({ standardCostRepository: repo } = await import('../../repositories/standard-cost.repository.js'));
    fx = await createBaseFixtures();
    ingredientId = await createIngredient(fx, { name: 'Farine STD', unit: 'kg', unitCost: 10 });
    ({ recipeId } = await createProductWithRecipe(fx, { name: 'Pain STD', price: 6, ingredients: [{ ingredientId, quantity: 0.1 }] }));
  });

  afterAll(async () => {
    if (!fx) return;
    await p().query(`DELETE FROM standard_costs WHERE recipe_id = $1`, [recipeId]);
    await cleanupFixtures(fx);
    await closeTestPool();
  });

  it('un article sans validation est « calculé, à valider »', async () => {
    const d = await repo.detail(recipeId, null, fx.storeId, 30);
    expect(d.situation).toBe('calculated');
    expect(d.validated).toBeNull();
    expect(d.matiere).toBeCloseTo(1, 4);
    expect(d.materials.length).toBeGreaterThan(0);
    expect(d.materials.reduce((t, m) => t + m.amount, 0)).toBeCloseTo(d.matiere, 3);
  });

  it('valider fige le calcul du jour comme coût de référence', async () => {
    await repo.validate(recipeId, null, fx.storeId, fx.userId, null);
    const d = await repo.detail(recipeId, null, fx.storeId, 30);
    expect(d.situation).toBe('validated');
    expect(d.validated?.coutProduction).toBeCloseTo(d.coutProduction, 4);
    expect(d.history).toHaveLength(1);
  });

  it('un prix de matière qui change rend le coût « à recalculer »', async () => {
    await p().query(`UPDATE ingredients SET unit_cost = 20 WHERE id = $1`, [ingredientId]);
    const d = await repo.detail(recipeId, null, fx.storeId, 30);
    expect(d.matiere).toBeCloseTo(2, 4);
    expect(d.situation).toBe('stale');
    expect(d.ecartPct).toBeGreaterThan(0);
    expect(d.reason).toMatch(/prix/);
  });

  it('valider à nouveau remplace l’ancien coût, gardé dans l’historique', async () => {
    await repo.validate(recipeId, null, fx.storeId, fx.userId, null);
    const d = await repo.detail(recipeId, null, fx.storeId, 30);
    expect(d.situation).toBe('validated');
    expect(d.history.map(h => h.status)).toEqual(['validated', 'replaced']);
    const live = (await p().query(`SELECT count(*)::int AS n FROM standard_costs WHERE recipe_id = $1 AND status = 'validated'`, [recipeId])).rows[0].n;
    expect(live).toBe(1);
  });

  it('la liste porte la situation de chaque article', async () => {
    const l = await repo.list(fx.storeId, { refresh: true });
    const row = l.rows.find(r => r.recipeId === recipeId);
    expect(row?.situation).toBe('validated');
    expect(row?.validated?.coutProduction).toBeCloseTo(row!.coutProduction, 4);
  });
});
