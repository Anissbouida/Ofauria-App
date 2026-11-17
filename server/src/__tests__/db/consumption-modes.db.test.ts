/**
 * M6-01 — mode de consommation par type d'ordre.
 * Fiche : 0,5 kg de farine par pièce ; ordres de 4 pièces.
 *  - « à la déclaration » : la déclaration sort 2 kg (une seule fois) ;
 *  - « manuel » : la déclaration ne sort rien ; la sortie manuelle de 2,2 kg sur l'ordre sort
 *    2,2 kg ; l'écart théorique / réel est de +0,2 kg (+10 %) ;
 *  - une sortie manuelle est refusée sur un ordre qui n'est pas en mode manuel.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, createLot, createProductWithRecipe, cleanupFixtures, num, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Modes de consommation (M6-01)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let types: typeof import('../../repositories/production-order-type.repository.js');
  let cons: typeof import('../../repositories/production-consumption.repository.js')['productionConsumptionRepository'];
  let fx: Fixtures; let flour: string; let productId: string; let declType: string; let manualType: string;
  const p = () => testPool();
  const today = new Date().toISOString().slice(0, 10);
  const stock = async () => num((await p().query(`SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [flour, fx.storeId])).rows[0]?.current_quantity);
  const code = (s: string) => `${s}_${RUN}`.slice(0, 30).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  const runPlan = async (orderTypeId: string) => {
    const plan = await repos.productionRepository.create({ planDate: today, type: 'daily', createdBy: fx.userId, storeId: fx.storeId, items: [{ productId, plannedQuantity: 4 }], orderTypeId, priority: 1 });
    fx.ids.plans.push(plan.id);
    const itemId = (await p().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [plan.id])).rows[0].id as string;
    await repos.productionRepository.confirm(plan.id, fx.userId);
    await repos.productionRepository.start(plan.id, fx.userId);
    return { planId: plan.id as string, itemId };
  };

  beforeAll(async () => {
    repos = await importRepositories();
    types = await import('../../repositories/production-order-type.repository.js');
    cons = (await import('../../repositories/production-consumption.repository.js')).productionConsumptionRepository;
    fx = await createBaseFixtures();
    flour = await createIngredient(fx, { name: 'Farine M601', unit: 'kg', unitCost: 10 });
    await createLot(fx, { ingredientId: flour, lotNumber: 'M601', pesage: 20, expiresInDays: 30, unitCost: 10 });
    productId = (await createProductWithRecipe(fx, { name: 'Pain M601', price: 3, ingredients: [{ ingredientId: flour, quantity: 0.5, unit: 'kg' }] })).productId;
    declType = (await types.productionOrderTypeRepository.create({ code: code('DECL'), label: `Déclaration ${RUN}`, requiresBonSortie: false, requiresWeighing: false, consumptionMode: 'a_la_declaration' }, fx.userId)).id;
    manualType = (await types.productionOrderTypeRepository.create({ code: code('MANU'), label: `Manuel ${RUN}`, requiresBonSortie: false, requiresWeighing: false, consumptionMode: 'manuel' }, fx.userId)).id;
  }, 60_000);

  afterAll(async () => {
    for (const t of [declType, manualType]) if (t) await types.productionOrderTypeRepository.update(t, { isActive: false }, fx.userId).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('à la déclaration : 2 kg sortis une seule fois', async () => {
    const before = await stock();
    const { planId, itemId } = await runPlan(declType);
    await repos.productionRepository.produceItems(planId, [{ planItemId: itemId, actualQuantity: 4 }], fx.userId, fx.storeId);
    expect(await stock()).toBeCloseTo(before - 2, 3);
    await expect(cons.manualIssue(planId, { ingredientId: flour, quantity: 1 }, fx.userId)).rejects.toThrow(/consommation manuelle/);
  });

  it('manuel : rien à la déclaration, sortie manuelle, écart théorique / réel', async () => {
    const before = await stock();
    const { planId, itemId } = await runPlan(manualType);
    await repos.productionRepository.produceItems(planId, [{ planItemId: itemId, actualQuantity: 4 }], fx.userId, fx.storeId);
    expect(await stock()).toBeCloseTo(before, 3);
    const issue = await cons.manualIssue(planId, { ingredientId: flour, quantity: 2.2, note: 'Pesée au pétrin' }, fx.userId);
    expect(issue.lots.reduce((t, l) => t + Number(l.quantityUsed), 0)).toBeCloseTo(2.2, 3);
    expect(await stock()).toBeCloseTo(before - 2.2, 3);
    const v = (await cons.variance(planId)).find(r => r.ingredient_id === flour)!;
    expect([v.theoretical, v.actual, v.variance, v.variance_pct]).toEqual([2, 2.2, 0.2, 10]);
  });
});
