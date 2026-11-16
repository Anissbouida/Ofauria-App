/**
 * G0-24 — déclaration de production : articles, pertes et saisies du lancement dans une
 * seule transaction.
 *  - une déclaration avec perte qui échoue ne laisse ni production ni perte ;
 *  - une déclaration réussie enregistre la perte (rattachée à l'article du plan, sans
 *    sortie de stock : ces pièces ne sont jamais entrées en stock), l'observation et
 *    les bases saisies.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createProductWithRecipe, cleanupFixtures, type Fixtures } from './helpers.js';

const num = (v: unknown) => parseFloat(String(v));

describe.skipIf(!hasTestDb)('Déclaration de production en une transaction (G0-24)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let declaration: typeof import('../../services/production-declaration.js');
  let fx: Fixtures;
  let productId: string, planId: string, planItemId: string;
  const p = () => testPool();
  const itemStatus = async () => (await p().query(`SELECT status, actual_quantity FROM production_plan_items WHERE id = $1`, [planItemId])).rows[0];
  const stock = async () => num((await p().query(
    `SELECT COALESCE((SELECT stock_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2), 0) AS s`, [productId, fx.storeId])).rows[0].s);
  const losses = async () => (await p().query(
    `SELECT quantity::float8 AS q, reason, plan_item_id, loss_type FROM product_losses WHERE production_plan_id = $1`, [planId])).rows;

  beforeAll(async () => {
    repos = await importRepositories();
    declaration = await import('../../services/production-declaration.js');
    fx = await createBaseFixtures();
    // Recette sans matière propre : pas de bon de sortie à livrer avant de démarrer.
    const pr = await createProductWithRecipe(fx, { name: 'Coffret G024', price: 3, shelfLifeDays: null, ingredients: [] });
    productId = pr.productId;
    const plan = await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId, plannedQuantity: 10 }],
    });
    planId = plan.id; fx.ids.plans.push(planId);
    await repos.productionRepository.confirm(planId, fx.userId);
    planItemId = (await p().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [planId])).rows[0].id;
    await repos.productionRepository.start(planId, fx.userId);
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM product_losses WHERE production_plan_id = $1`, [planId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('une perte qui échoue annule toute la déclaration : ni production, ni perte, ni observation', async () => {
    const before = await itemStatus();
    await expect(declaration.declareProduction(planId, {
      items: [{ planItemId, actualQuantity: 8 }],
      losses: [{ planItemId, quantity: 2, reason: 'motif_inexistant' }],   // refusé par la base (motif hors liste)
      observations: 'Four trop chaud',
    }, { userId: fx.userId, storeId: fx.storeId })).rejects.toThrow();
    expect(await itemStatus()).toEqual(before);
    expect(before.status).not.toBe('produced');
    expect(await stock()).toBe(0);
    expect(await losses()).toHaveLength(0);
    expect(await declaration.listPlanObservations(planId)).toHaveLength(0);
  }, 60_000);

  it('déclaration réussie : production, perte rattachée à l\'article, observation et bases enregistrées', async () => {
    const base = '11111111-1111-4111-8111-111111111111';
    await declaration.declareProduction(planId, {
      items: [{ planItemId, actualQuantity: 8 }],
      losses: [{ planItemId, quantity: 2, reason: 'rate', reasonNote: 'Deux pièces ratées au démoulage' }],
      observations: '  Four trop chaud  ',
      bases: [{ subRecipeId: base, actualQuantity: 3.5, alreadyProduced: false }],
    }, { userId: fx.userId, storeId: fx.storeId });
    expect(await itemStatus()).toMatchObject({ status: 'produced' });
    expect(await stock()).toBe(8);                          // la perte n'est pas sortie du stock : jamais entrée
    expect(await losses()).toEqual([{ q: 2, reason: 'rate', plan_item_id: planItemId, loss_type: 'production' }]);
    const obs = await declaration.listPlanObservations(planId);
    expect(obs).toHaveLength(1);
    expect(obs[0]).toMatchObject({ note: 'Four trop chaud', bases: [{ subRecipeId: base, actualQuantity: 3.5, alreadyProduced: false }] });
  }, 60_000);
});
