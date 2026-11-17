/**
 * M2-01 à M2-03 — types d'ordre, en-tête d'ordre, une seule machine à états.
 *  - la table des transitions SQL (fn_production_transition_allowed, mig 299) et la
 *    définition TypeScript (services/production-state.ts) sont identiques : le test
 *    échoue si l'une change sans l'autre ;
 *  - un plan créé sans type reçoit « Plan du jour », un numéro OF et des dates ;
 *  - un type sans bon de sortie passe de « confirmé » à « en production » sans BSI et
 *    consomme la matière à la déclaration ; « Plan du jour » refuse ce démarrage tant
 *    que le bon n'est pas clôturé ;
 *  - les statuts de ligne sont contraints.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, createProductWithRecipe, cleanupFixtures, num, RUN,
  type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Types d\'ordre de fabrication (M2-01 à M2-03)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let state: typeof import('../../services/production-state.js');
  let types: typeof import('../../repositories/production-order-type.repository.js');
  let fx: Fixtures;
  let farineId: string; let productId: string; let directTypeId: string;
  const p = () => testPool();
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    repos = await importRepositories();
    state = await import('../../services/production-state.js');
    types = await import('../../repositories/production-order-type.repository.js');
    fx = await createBaseFixtures();
    farineId = await createIngredient(fx, { name: 'Farine M2', unit: 'kg', unitCost: 10 });
    await createLot(fx, { ingredientId: farineId, lotNumber: 'M2', pesage: 50, expiresInDays: 30, unitCost: 10 });
    productId = (await createProductWithRecipe(fx, {
      name: 'Pain M2', price: 3, shelfLifeDays: null,
      ingredients: [{ ingredientId: farineId, quantity: 0.5, unit: 'kg' }],
    })).productId;
    directTypeId = (await types.productionOrderTypeRepository.create({
      code: `DIRECT_${RUN}`.slice(0, 30).toUpperCase().replace(/[^A-Z0-9_]/g, '_'), label: `Ordre direct ${RUN}`,
      requiresBonSortie: false, requiresWeighing: true, consumptionMode: 'au_bon_de_sortie',
    }, fx.userId)).id;
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx);
    await p().query(`DELETE FROM production_order_types WHERE id = $1`, [directTypeId]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('la table SQL des transitions est exactement celle de TypeScript', async () => {
    for (const [entity, table] of [['plan', state.PLAN_TRANSITIONS], ['bon', state.BON_TRANSITIONS]] as const) {
      const statuses = Object.keys(table);
      const sql = await p().query(
        `SELECT f, t FROM unnest($2::text[]) f CROSS JOIN unnest($2::text[]) t
          WHERE f <> t AND fn_production_transition_allowed($1, f, t) ORDER BY 1, 2`, [entity, statuses]);
      const fromSql = sql.rows.map(r => `${r.f}->${r.t}`).sort();
      const fromTs = Object.entries(table as Record<string, string[]>).flatMap(([f, tos]) => tos.map(t => `${f}->${t}`)).sort();
      expect(fromSql, entity).toEqual(fromTs);
    }
  });

  it('un type sans bon de sortie est rendu cohérent : ni pesage, ni consommation au bon', async () => {
    const t = await types.productionOrderTypeRepository.get(directTypeId);
    expect(t).toMatchObject({ requires_bon_sortie: false, requires_weighing: false, consumption_mode: 'a_la_declaration' });
  });

  it('plan créé sans type : « Plan du jour », numéro OF, priorité 3, dates du jour', async () => {
    const plan = await repos.productionRepository.create({
      planDate: today, type: 'daily', createdBy: fx.userId, storeId: fx.storeId, items: [{ productId, plannedQuantity: 2 }],
    });
    fx.ids.plans.push(plan.id);
    const row = (await p().query(
      `SELECT pp.of_number, pp.priority, pp.planned_start, pp.planned_end, t.code
         FROM production_plans pp JOIN production_order_types t ON t.id = pp.order_type_id WHERE pp.id = $1`, [plan.id])).rows[0];
    expect(row.code).toBe('PLAN_JOUR');
    expect(row.of_number).toMatch(/^OF-\d{4}-\d{5,}$/);
    expect(row.priority).toBe(3);
    expect(new Date(row.planned_end).getTime()).toBeGreaterThan(new Date(row.planned_start).getTime());
  });

  it('« Plan du jour » : démarrage refusé tant que le bon de sortie n\'est pas clôturé', async () => {
    const plan = await repos.productionRepository.create({
      planDate: today, type: 'daily', createdBy: fx.userId, storeId: fx.storeId, items: [{ productId, plannedQuantity: 2 }],
    });
    fx.ids.plans.push(plan.id);
    await repos.productionRepository.confirm(plan.id, fx.userId);
    expect((await p().query(`SELECT status FROM production_plans WHERE id = $1`, [plan.id])).rows[0].status).toBe('awaiting_ingredients');
    await expect(repos.productionRepository.start(plan.id, fx.userId)).rejects.toThrow(/bon de sortie/i);
  });

  it('type sans bon de sortie : confirmé → en production directement, matière consommée à la déclaration', async () => {
    const plan = await repos.productionRepository.create({
      planDate: today, type: 'daily', createdBy: fx.userId, storeId: fx.storeId, items: [{ productId, plannedQuantity: 4 }],
      orderTypeId: directTypeId, priority: 1,
    });
    fx.ids.plans.push(plan.id);
    const { warnings } = await repos.productionRepository.confirm(plan.id, fx.userId);
    expect(warnings.join(' ')).toMatch(/pas de bon de sortie/);
    expect((await p().query(`SELECT COUNT(*)::int AS n FROM production_bons_sortie WHERE plan_id = $1`, [plan.id])).rows[0].n).toBe(0);
    expect((await p().query(`SELECT status, priority FROM production_plans WHERE id = $1`, [plan.id])).rows[0]).toEqual({ status: 'confirmed', priority: 1 });

    const stockBefore = num((await p().query(`SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [farineId, fx.storeId])).rows[0]?.current_quantity);
    await repos.productionRepository.start(plan.id, fx.userId);
    expect((await p().query(`SELECT status FROM production_plans WHERE id = $1`, [plan.id])).rows[0].status).toBe('in_progress');
    const item = (await p().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [plan.id])).rows[0].id;
    await repos.productionRepository.complete(plan.id, [{ planItemId: item, actualQuantity: 4 }], fx.userId, fx.storeId);
    const stockAfter = num((await p().query(`SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [farineId, fx.storeId])).rows[0]?.current_quantity);
    expect(stockBefore - stockAfter).toBeCloseTo(2, 3); // 4 × 0,5 kg
  });

  it('statut de ligne hors liste refusé par la base', async () => {
    const plan = await repos.productionRepository.create({
      planDate: today, type: 'daily', createdBy: fx.userId, storeId: fx.storeId, items: [{ productId, plannedQuantity: 1 }],
    });
    fx.ids.plans.push(plan.id);
    await expect(p().query(`UPDATE production_plan_items SET status = 'termine' WHERE plan_id = $1`, [plan.id]))
      .rejects.toThrow(/chk_production_plan_items_status/);
  });

  it('le type par défaut ne peut pas être désactivé', async () => {
    const def = (await types.productionOrderTypeRepository.list()).find(t => t.is_default)!;
    await expect(types.productionOrderTypeRepository.update(def.id, { isActive: false }, fx.userId)).rejects.toThrow(/par défaut/);
  });
});
