/**
 * Qualité (plan d'exécution multi-industries, étape 7, mig 641).
 *
 *   - point de contrôle « avant transfert » sur une FAMILLE d'articles : le transfert crée le
 *     contrôle et reste refusé tant que le contrôle bloquant n'est pas soldé ;
 *   - point de contrôle « avant livraison » : contrôle créé une fois par bon de livraison ;
 *   - règle du point critique paramétrable (au moins un relevé, tous conformes, dernier conforme) ;
 *   - plans de contrôle par famille exportés dans le profil, validés et réappliqués sans doublon.
 */
process.env.POS_ALLOW_NEGATIVE_STOCK = 'off';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, createProductWithRecipe, cleanupFixtures,
  num, RUN, type Fixtures,
} from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe.skipIf(!hasTestDb)('Étape 7 — points de contrôle qualité', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let qcp: any; let profile: any; let refs: any; let policies: any;
  let fx: Fixtures; let productId: string; let categoryId: number; let customerId: string;
  const p = () => testPool();
  const catName = `Famille QC ${RUN}`;
  const dnIds: string[] = [];

  beforeAll(async () => {
    repos = await importRepositories();
    qcp = (await import('../../repositories/quality-control-plan.repository.js')).qualityControlPlanRepository;
    profile = await import('../../services/industry-profile.js');
    refs = await import('../../services/process-referentials.js');
    policies = await import('../../services/policies.js');
    await p().query(`DELETE FROM policy_values WHERE key IN ('quality.ccp_rule', 'production.enforce_declared_steps', 'production.process_engine')`);
    policies.invalidatePolicies();
    fx = await createBaseFixtures();
    categoryId = (await p().query(`INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING id`, [catName, `famille-qc-${RUN}`.toLowerCase()])).rows[0].id;
    const farine = await createIngredient(fx, { name: 'Farine QC', unit: 'kg', unitCost: 10 });
    await createLot(fx, { ingredientId: farine, lotNumber: 'QC7', pesage: 100, expiresInDays: 30, unitCost: 10 });
    productId = (await createProductWithRecipe(fx, { name: 'Pain QC', price: 2, ingredients: [{ ingredientId: farine, quantity: 0.5, unit: 'kg' }] })).productId;
    await p().query(`UPDATE products SET category_id = $2 WHERE id = $1`, [productId, categoryId]);
    customerId = (await p().query(`INSERT INTO customers (first_name, last_name, company_name, customer_type) VALUES ('Pro', 'QC ${RUN}', 'Client QC ${RUN}', 'professionnel') RETURNING id`)).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM policy_values WHERE key = 'quality.ccp_rule'`).catch(() => undefined);
    policies?.invalidatePolicies();
    if (dnIds.length) {
      await p().query(`DELETE FROM quality_inspections WHERE delivery_note_id = ANY($1::uuid[])`, [dnIds]).catch(() => undefined);
      await p().query(`DELETE FROM delivery_note_items WHERE delivery_note_id = ANY($1::uuid[])`, [dnIds]).catch(() => undefined);
      await p().query(`DELETE FROM delivery_notes WHERE id = ANY($1::uuid[])`, [dnIds]).catch(() => undefined);
    }
    await p().query(`DELETE FROM quality_control_plan_lines WHERE product_category_id = $1`, [categoryId]).catch(() => undefined);
    await p().query(`UPDATE products SET category_id = NULL WHERE id = $1`, [productId]).catch(() => undefined);
    await p().query(`DELETE FROM customers WHERE id = $1`, [customerId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await p().query(`DELETE FROM categories WHERE id = $1`, [categoryId]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  async function producedPlan() {
    const plan = await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId, plannedQuantity: 2 }],
    });
    fx.ids.plans.push(plan.id);
    await repos.productionRepository.confirm(plan.id, fx.userId);
    const bon = (await repos.bonSortieRepository.findByPlan(plan.id))[0];
    await repos.bonSortieRepository.markAsPreparation(bon.id, fx.userId);
    const fresh = (await repos.bonSortieRepository.findByPlan(plan.id))[0];
    await repos.bonSortieRepository.weighLignes(bon.id, fx.userId, (fresh.lines as any[]).filter(l => num(l.allocated_quantity) > 0)
      .map(l => ({ ligneId: l.id, actualQuantity: num(l.allocated_quantity), source: 'manual' })));
    await repos.bonSortieRepository.markAsReady(bon.id, fx.userId);
    await repos.bonSortieRepository.acceptReception(bon.id, fx.userId);
    await repos.productionRepository.start(plan.id, fx.userId);
    const item = (await p().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [plan.id])).rows[0];
    await repos.productionRepository.produceItems(plan.id, [{ planItemId: item.id, actualQuantity: 2 }], fx.userId, fx.storeId);
    return { planId: plan.id as string, itemId: item.id as string };
  }

  it('avant transfert sur une famille : contrôle créé, transfert refusé tant qu\'il n\'est pas soldé', async () => {
    await qcp.create({ productCategoryId: categoryId, stage: 'avant_transfert', characteristic: 'Aspect et étiquetage', charType: 'oui_non', frequency: 'chaque_lot', isBlocking: true }, fx.userId);
    const { planId, itemId } = await producedPlan();
    await expect(repos.productionRepository.createTransfer(planId, [itemId], fx.userId, fx.storeId)).rejects.toThrow(/Contrôle avant transfert/);
    const insp = (await p().query(`SELECT id, status FROM quality_inspections WHERE plan_item_id = $1 AND control_stage = 'avant_transfert'`, [itemId])).rows;
    expect(insp).toHaveLength(1);
    expect(insp[0].status).toBe('a_faire');
    // Un deuxième essai ne recrée pas de contrôle.
    await expect(repos.productionRepository.createTransfer(planId, [itemId], fx.userId, fx.storeId)).rejects.toThrow(/Contrôle avant transfert/);
    expect((await p().query(`SELECT count(*)::int AS n FROM quality_inspections WHERE plan_item_id = $1 AND control_stage = 'avant_transfert'`, [itemId])).rows[0].n).toBe(1);
    // Contrôle fait et conforme : le transfert passe.
    await p().query(`UPDATE quality_inspections SET status = 'faite', conformity = true WHERE id = $1`, [insp[0].id]);
    const t = await repos.productionRepository.createTransfer(planId, [itemId], fx.userId, fx.storeId);
    expect(t).toBeTruthy();
  });

  it('avant livraison : un contrôle par bon, bloquant tant qu\'il est à faire', async () => {
    await qcp.create({ productCategoryId: categoryId, stage: 'avant_livraison', characteristic: 'Température à cœur', charType: 'mesure', maxValue: 4, unit: '°C', frequency: 'chaque_lot', isBlocking: true }, fx.userId);
    const dn = (await p().query(
      `INSERT INTO delivery_notes (number, customer_id, status, store_id) VALUES ($1, $2, 'prepared', $3) RETURNING id`,
      [`BL-QC-${RUN}`.slice(0, 40), customerId, fx.storeId])).rows[0].id;
    dnIds.push(dn);
    await p().query(`INSERT INTO delivery_note_items (delivery_note_id, product_id, description, quantity, unit_price, subtotal) VALUES ($1, $2, 'Pain QC', 3, 2, 6)`, [dn, productId]);
    const created = await qcp.generateBeforeDelivery(p(), dn);
    expect(created).toHaveLength(1);
    expect(await qcp.generateBeforeDelivery(p(), dn)).toHaveLength(0);
    expect(await qcp.blockingOpen(p(), 'avant_livraison', { deliveryNoteId: dn })).toBe(1);
    const { deliveryNoteRepository } = await import('../../repositories/delivery-note.repository.js');
    await expect(deliveryNoteRepository.ship(dn, fx.userId)).rejects.toThrow(/Contrôle avant livraison/);
    await p().query(`UPDATE quality_inspections SET status = 'faite', conformity = true WHERE id = $1`, [created[0]]);
    expect(await qcp.blockingOpen(p(), 'avant_livraison', { deliveryNoteId: dn })).toBe(0);
  });

  it('règle du point critique : défaut au moins un relevé ; tous conformes ; dernier conforme', async () => {
    const gate = (readings: number, ko: number, last: boolean | null) => ({ readings, non_conformes: ko, dernier_conforme: last, workshop: null, store_id: null });
    expect(await refs.ccpClosureRefusal(gate(0, 0, null))).toMatch(/au moins un relevé/);
    expect(await refs.ccpClosureRefusal(gate(1, 1, false))).toBeNull();

    await policies.setPolicy('quality.ccp_rule', 'company', '', { rule: 'tous_conformes', min_readings: 2 }, fx.userId);
    expect(await refs.ccpClosureRefusal(gate(1, 0, true))).toMatch(/2 relevés/);
    expect(await refs.ccpClosureRefusal(gate(2, 1, true))).toMatch(/hors tolérance/);
    expect(await refs.ccpClosureRefusal(gate(2, 0, true))).toBeNull();

    await policies.setPolicy('quality.ccp_rule', 'company', '', { rule: 'dernier_conforme', min_readings: 1 }, fx.userId);
    expect(await refs.ccpClosureRefusal(gate(2, 1, true))).toBeNull();
    expect(await refs.ccpClosureRefusal(gate(2, 1, false))).toMatch(/dernier relevé/);
  });

  it('plans de contrôle par famille : exportés dans le profil, validés, réappliqués sans doublon', async () => {
    const layers = await profile.exportLayers(p());
    const mine = (layers.control_plans ?? []).filter((c: any) => c.category === catName);
    expect(mine.map((c: any) => c.stage).sort()).toEqual(['avant_livraison', 'avant_transfert']);

    const warnings: string[] = [];
    const clean = profile.cleanLayers({ control_plans: [...mine, { category: catName, stage: 'reception', characteristic: 'X', char_type: 'oui_non', frequency: 'chaque_lot' },
      { category: catName, stage: 'final', characteristic: 'Poids', char_type: 'mesure', frequency: 'chaque_lot' }] }, warnings);
    expect(clean.control_plans).toHaveLength(2);
    expect(warnings.filter(w => w.startsWith('Ligne de plan de contrôle ignorée'))).toHaveLength(2);

    const again = await profile.applyLayers(p(), { order_types: [], policies: [], print_templates: [], control_plans: clean.control_plans }, fx.userId);
    expect(again.controlPlans).toBe(0);
    const extra = await profile.applyLayers(p(), { order_types: [], policies: [], print_templates: [], control_plans: [
      { ...clean.control_plans[0], stage: 'final', characteristic: 'Poids unitaire', char_type: 'mesure', min_value: 90, max_value: 110, unit: 'g' },
      { ...clean.control_plans[0], category: 'Famille qui n\'existe pas ici', characteristic: 'Rien' },
    ] }, fx.userId);
    expect(extra.controlPlans).toBe(1);
  });
});
