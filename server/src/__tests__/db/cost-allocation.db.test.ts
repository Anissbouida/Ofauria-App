/**
 * M3-05 — clé de répartition du coût d'un plan entre ses articles.
 * Plan : A (10 pièces de 0,1 kg à 2 DH) et B (5 pièces de 0,4 kg à 10 DH), coût total 100 :
 *   poids          → 1 kg / 2 kg      → 33,33 / 66,67
 *   quantité       → 10 / 5           → 66,67 / 33,33
 *   valeur de vente→ 20 / 50 DH       → 28,57 / 71,43
 *   manuelle       → 25 % / 75 %      → 25 / 75
 * La somme des parts égale toujours le coût total ; une clé inapplicable retombe sur la
 * quantité et le signale. La clé se règle au niveau de l'établissement (politique).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, createProductWithRecipe, cleanupFixtures, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Clé de répartition du coût (M3-05)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let cout: typeof import('../../repositories/production-cout.repository.js')['productionCoutRepository'];
  let setPolicy: typeof import('../../services/policies.js')['setPolicy'];
  let fx: Fixtures; let planId: string; let itemA: string; let itemB: string;
  const p = () => testPool();
  const byName = (r: { items: { product_name: string; cost: number }[] }) => Object.fromEntries(r.items.map(i => [i.product_name.split(' ')[0], i.cost]));
  const withKey = async (key: string) => {
    await setPolicy('production.cost_allocation_key', 'store', fx.storeId, { key }, fx.userId);
    return cout.allocate(planId, 100);
  };

  beforeAll(async () => {
    repos = await importRepositories();
    cout = (await import('../../repositories/production-cout.repository.js')).productionCoutRepository;
    setPolicy = (await import('../../services/policies.js')).setPolicy;
    fx = await createBaseFixtures();
    const flour = await createIngredient(fx, { name: 'Farine M305', unit: 'kg', unitCost: 8 });
    const a = await createProductWithRecipe(fx, { name: 'Apain M305', price: 2, ingredients: [{ ingredientId: flour, quantity: 0.05, unit: 'kg' }] });
    const b = await createProductWithRecipe(fx, { name: 'Bgâteau M305', price: 10, ingredients: [{ ingredientId: flour, quantity: 0.2, unit: 'kg' }] });
    await p().query(`UPDATE recipes SET piece_weight_kg = 0.1 WHERE id = $1`, [a.recipeId]);
    await p().query(`UPDATE recipes SET piece_weight_kg = 0.4 WHERE id = $1`, [b.recipeId]);
    planId = (await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId: a.productId, plannedQuantity: 10 }, { productId: b.productId, plannedQuantity: 5 }],
    })).id;
    fx.ids.plans.push(planId);
    const items = (await p().query(`SELECT ppi.id, p.name FROM production_plan_items ppi JOIN products p ON p.id = ppi.product_id WHERE ppi.plan_id = $1`, [planId])).rows;
    itemA = items.find(i => i.name.startsWith('Apain')).id; itemB = items.find(i => i.name.startsWith('Bgâteau')).id;
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM policy_values WHERE scope_type = 'store' AND scope_id = $1`, [fx?.storeId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('quatre clés, la somme égale toujours le coût total', async () => {
    const poids = await withKey('poids');
    expect(byName(poids)).toEqual({ Apain: 33.33, Bgâteau: 66.67 });
    const qte = await withKey('quantite');
    expect(byName(qte)).toEqual({ Apain: 66.67, Bgâteau: 33.33 });
    const val = await withKey('valeur_de_vente');
    expect(byName(val)).toEqual({ Apain: 28.57, Bgâteau: 71.43 });
    await cout.setCostShares(planId, [{ planItemId: itemA, pct: 25 }, { planItemId: itemB, pct: 75 }]);
    const man = await withKey('manuelle');
    expect(byName(man)).toEqual({ Apain: 25, Bgâteau: 75 });
    for (const r of [poids, qte, val, man]) expect(r.items.reduce((t, i) => t + i.cost, 0)).toBeCloseTo(100, 6);
    expect(man).toMatchObject({ key: 'manuelle', applied: 'manuelle', fallback: null, source: 'store' });
  });

  it('parts manuelles différentes de 100 % refusées ; clé inapplicable → quantité, signalée', async () => {
    await expect(cout.setCostShares(planId, [{ planItemId: itemA, pct: 30 }, { planItemId: itemB, pct: 30 }])).rejects.toThrow(/100 %/);
    await p().query(`UPDATE production_plan_items SET cost_share_pct = NULL WHERE plan_id = $1`, [planId]);
    const r = await withKey('manuelle');
    expect(r).toMatchObject({ applied: 'quantite' });
    expect(r.fallback).toMatch(/Parts manuelles/);
  });
});
