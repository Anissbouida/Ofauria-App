/**
 * C-06 — test d'acceptation par profil : un ordre se déroule selon le type d'ordre et la
 * politique de répartition du coût du profil (valeurs lues dans sector_packs.profile).
 *  - discret : sans bon de sortie, matière consommée à la déclaration, coût à la quantité ;
 *  - atelier : consommation manuelle (rien n'est déduit à la déclaration, sortie saisie à la
 *    main), clé « parts saisies » (repli quantité sans parts) ;
 *  - process : bon de sortie généré à la confirmation, démarrage refusé tant qu'il n'est pas clos.
 * Chaque type est recréé avec un code suffixé (les codes du profil restent libres dans la base de test).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, createProductWithRecipe, cleanupFixtures, num, RUN,
  type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Acceptation par profil : déroulé d\'un ordre (C-06)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let types: typeof import('../../repositories/production-order-type.repository.js')['productionOrderTypeRepository'];
  let consumption: typeof import('../../repositories/production-consumption.repository.js')['productionConsumptionRepository'];
  let cout: typeof import('../../repositories/production-cout.repository.js')['productionCoutRepository'];
  let fx: Fixtures;
  let matiereId: string; let productId: string;
  const typeIds: string[] = []; const policyCodes: string[] = [];
  const p = () => testPool();
  const today = new Date().toISOString().slice(0, 10);
  const stock = async () => num((await p().query(`SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [matiereId, fx.storeId])).rows[0]?.current_quantity);

  /** Type d'ordre par défaut du profil, recréé sous un code suffixé, + sa clé de répartition au niveau du type. */
  async function profileType(code: 'process' | 'discret' | 'atelier') {
    const profile = (await p().query(`SELECT profile FROM sector_packs WHERE code = $1`, [code])).rows[0].profile;
    const def = profile.order_types.find((t: { is_default: boolean }) => t.is_default);
    const t = await types.create({
      code: `${def.code}_${RUN}`.slice(0, 30).toUpperCase().replace(/[^A-Z0-9_]/g, '_'), label: `${def.label} ${RUN}`,
      requiresBonSortie: def.requires_bon_sortie, requiresWeighing: def.requires_weighing, requiresQualityCheck: def.requires_quality_check,
      consumptionMode: def.consumption_mode, isSubcontracting: def.is_subcontracting,
    }, fx.userId);
    typeIds.push(t.id);
    const key = profile.policies.find((x: { key: string }) => x.key === 'production.cost_allocation_key');
    if (key) {
      await p().query(`INSERT INTO policy_values (key, scope_type, scope_id, value) VALUES ('production.cost_allocation_key', 'order_type', $1, $2::jsonb)`,
        [t.code, JSON.stringify(key.value)]);
      policyCodes.push(t.code);
      (await import('../../services/policies.js')).invalidatePolicies(); // écrite hors de setPolicy
    }
    return { type: t, expectedKey: key?.value.key as string | undefined };
  }

  async function newPlan(orderTypeId: string, qty: number) {
    const plan = await repos.productionRepository.create({
      planDate: today, type: 'daily', createdBy: fx.userId, storeId: fx.storeId, items: [{ productId, plannedQuantity: qty }], orderTypeId,
    });
    fx.ids.plans.push(plan.id);
    return plan.id as string;
  }

  beforeAll(async () => {
    repos = await importRepositories();
    types = (await import('../../repositories/production-order-type.repository.js')).productionOrderTypeRepository;
    consumption = (await import('../../repositories/production-consumption.repository.js')).productionConsumptionRepository;
    cout = (await import('../../repositories/production-cout.repository.js')).productionCoutRepository;
    fx = await createBaseFixtures();
    matiereId = await createIngredient(fx, { name: `Tôle C06 ${RUN}`, unit: 'kg', unitCost: 12 });
    await createLot(fx, { ingredientId: matiereId, lotNumber: `C06${RUN}`.slice(0, 20), pesage: 100, expiresInDays: 60, unitCost: 12 });
    productId = (await createProductWithRecipe(fx, {
      name: `Étagère C06 ${RUN}`, price: 150, shelfLifeDays: null,
      ingredients: [{ ingredientId: matiereId, quantity: 2, unit: 'kg' }],
    })).productId;
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx);
    for (const c of policyCodes) await p().query(`DELETE FROM policy_values WHERE scope_type = 'order_type' AND scope_id = $1`, [c]).catch(() => undefined);
    for (const id of typeIds) await p().query(`DELETE FROM production_order_types WHERE id = $1`, [id]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('discret : sans bon de sortie, consommation à la déclaration, coût à la quantité', async () => {
    const { type, expectedKey } = await profileType('discret');
    expect(expectedKey).toBe('quantite');
    const planId = await newPlan(type.id, 5);
    await repos.productionRepository.confirm(planId, fx.userId);
    expect((await p().query(`SELECT COUNT(*)::int AS n FROM production_bons_sortie WHERE plan_id = $1`, [planId])).rows[0].n).toBe(0);
    await repos.productionRepository.start(planId, fx.userId);
    const before = await stock();
    const item = (await p().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [planId])).rows[0].id;
    await repos.productionRepository.complete(planId, [{ planItemId: item, actualQuantity: 5 }], fx.userId, fx.storeId);
    expect(before - await stock()).toBeCloseTo(10, 3); // 5 × 2 kg
    const c = await cout.computePlanCost(planId);
    expect(c.allocation).toMatchObject({ key: 'quantite', applied: 'quantite' });
    expect(c.coutMatieres).toBeGreaterThan(0);
  });

  it('atelier : consommation manuelle, rien de déduit à la déclaration', async () => {
    const { type, expectedKey } = await profileType('atelier');
    expect(expectedKey).toBe('manuelle');
    const planId = await newPlan(type.id, 2);
    await repos.productionRepository.confirm(planId, fx.userId);
    await repos.productionRepository.start(planId, fx.userId);
    const before = await stock();
    const item = (await p().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [planId])).rows[0].id;
    await repos.productionRepository.complete(planId, [{ planItemId: item, actualQuantity: 2 }], fx.userId, fx.storeId);
    expect(await stock()).toBeCloseTo(before, 3);
    await consumption.manualIssue(planId, { ingredientId: matiereId, quantity: 3.5, note: 'Débit affaire' }, fx.userId);
    expect(before - await stock()).toBeCloseTo(3.5, 3);
    const c = await cout.computePlanCost(planId);
    // Parts non saisies sur l'ordre : la clé « manuelle » se replie sur la quantité, avec un message.
    expect(c.allocation).toMatchObject({ key: 'manuelle', applied: 'quantite' });
    expect(c.allocation.fallback).toMatch(/Parts manuelles/);
  });

  it('process : bon de sortie à la confirmation, démarrage refusé tant qu\'il n\'est pas clos', async () => {
    const { type, expectedKey } = await profileType('process');
    expect(expectedKey).toBe('poids');
    expect(type).toMatchObject({ requires_bon_sortie: true, requires_weighing: true, requires_quality_check: true });
    const planId = await newPlan(type.id, 3);
    await repos.productionRepository.confirm(planId, fx.userId);
    expect((await p().query(`SELECT status FROM production_plans WHERE id = $1`, [planId])).rows[0].status).toBe('awaiting_ingredients');
    expect((await p().query(`SELECT COUNT(*)::int AS n FROM production_bons_sortie WHERE plan_id = $1`, [planId])).rows[0].n).toBe(1);
    await expect(repos.productionRepository.start(planId, fx.userId)).rejects.toThrow(/bon de sortie/i);
  });
});
