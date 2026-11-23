/**
 * Documents de production pilotables et approbations de production (plan d'exécution
 * multi-industries, étape 6, mig 640).
 *
 *   - registre : douze documents, tous actifs, aucun obligatoire (comportement actuel) ;
 *   - désactiver « Fiche de pesage » et « Rapport de rendement » n'empêche ni la pesée ni la
 *     déclaration : seul le document disparaît ; obligatoire implique actif ;
 *   - sans règle d'approbation, rien ne change ; avec une règle sur la confirmation d'un
 *     ordre : demande créée, action refusée tant qu'elle attend, approuvée → ordre confirmé ;
 *   - une non-conformité reçoit un numéro de la série « NC-AAAA-00001 ».
 */
process.env.POS_ALLOW_NEGATIVE_STOCK = 'off';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, createProductWithRecipe, cleanupFixtures,
  num, RUN, type Fixtures,
} from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe.skipIf(!hasTestDb)('Étape 6 — documents de production et approbations', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let docs: any; let gates: any; let approvals: any; let quality: any;
  let fx: Fixtures; let productId: string; let ruleId: string | null = null; let manager: string | null = null;
  const p = () => testPool();
  const planIds: string[] = []; const ncIds: string[] = [];

  beforeAll(async () => {
    repos = await importRepositories();
    await import('../../services/approval-handlers.js');
    docs = (await import('../../repositories/production-document.repository.js')).productionDocumentRepository;
    gates = await import('../../services/production-approvals.js');
    approvals = (await import('../../services/approval.service.js')).approvalService;
    quality = (await import('../../repositories/quality.repository.js')).qualityRepository;
    fx = await createBaseFixtures();
    const farine = await createIngredient(fx, { name: 'Farine docs', unit: 'kg', unitCost: 10 });
    await createLot(fx, { ingredientId: farine, lotNumber: 'DOC', pesage: 100, expiresInDays: 30, unitCost: 10 });
    productId = (await createProductWithRecipe(fx, { name: 'Pain docs', price: 2, ingredients: [{ ingredientId: farine, quantity: 0.5, unit: 'kg' }] })).productId;
  }, 60_000);

  afterAll(async () => {
    await p().query(`UPDATE production_documents SET enabled = true, mandatory = false`).catch(() => undefined);
    if (planIds.length) await p().query(`DELETE FROM approval_requests WHERE doc_id = ANY($1::text[])`, [planIds]).catch(() => undefined);
    if (ruleId) await p().query(`DELETE FROM approval_rules WHERE id = $1`, [ruleId]).catch(() => undefined);
    if (manager) await p().query(`DELETE FROM users WHERE id = $1`, [manager]).catch(() => undefined);
    if (ncIds.length) await p().query(`DELETE FROM quality_nonconformities WHERE id = ANY($1::uuid[])`, [ncIds]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  async function newPlan() {
    const plan = await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId, plannedQuantity: 2 }],
    });
    fx.ids.plans.push(plan.id); planIds.push(plan.id);
    return plan.id as string;
  }

  it('le registre livre douze documents actifs, aucun obligatoire', async () => {
    const list = await docs.list();
    expect(list).toHaveLength(12);
    expect(list.every((d: any) => d.enabled && !d.mandatory)).toBe(true);
    expect(list.map((d: any) => d.docKey)).toEqual(expect.arrayContaining(['fiche_pesage', 'rapport_rendement', 'fiche_non_conformite', 'bon_envoi_soustraitance']));
  });

  it('obligatoire implique actif ; désactiver retire l\'obligation', async () => {
    const off = await docs.update('fiche_controle', { enabled: false });
    expect(off.enabled).toBe(false);
    const must = await docs.update('fiche_controle', { mandatory: true });
    expect(must).toMatchObject({ enabled: true, mandatory: true });
    const again = await docs.update('fiche_controle', { enabled: false });
    expect(again).toMatchObject({ enabled: false, mandatory: false });
    expect((await docs.update('inconnu', { enabled: true })).error).toMatch(/inconnu/);
    await docs.update('fiche_controle', { enabled: true });
  });

  it('fiche de pesage et rapport de rendement désactivés : pesée et déclaration restent possibles', async () => {
    await docs.update('fiche_pesage', { enabled: false });
    await docs.update('rapport_rendement', { enabled: false });
    expect(await docs.isEnabled('fiche_pesage')).toBe(false);
    expect(await docs.isEnabled('document_absent_du_registre')).toBe(true);

    const planId = await newPlan();
    await repos.productionRepository.confirm(planId, fx.userId);
    const bon = (await repos.bonSortieRepository.findByPlan(planId))[0];
    await repos.bonSortieRepository.markAsPreparation(bon.id, fx.userId);
    const fresh = (await repos.bonSortieRepository.findByPlan(planId))[0];
    await repos.bonSortieRepository.weighLignes(bon.id, fx.userId, (fresh.lines as any[]).filter(l => num(l.allocated_quantity) > 0)
      .map(l => ({ ligneId: l.id, actualQuantity: num(l.allocated_quantity), source: 'manual' })));
    const weighed = (await p().query(
      `SELECT count(*)::int AS n FROM production_bons_sortie_lignes WHERE bon_id = $1 AND weighed_at IS NOT NULL`, [bon.id])).rows[0].n;
    expect(weighed).toBeGreaterThan(0);
    await repos.bonSortieRepository.markAsReady(bon.id, fx.userId);
    await repos.bonSortieRepository.acceptReception(bon.id, fx.userId);
    await repos.productionRepository.start(planId, fx.userId);
    const item = (await p().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [planId])).rows[0];
    await repos.productionRepository.produceItems(planId, [{ planItemId: item.id, actualQuantity: 2 }], fx.userId, fx.storeId);
    const st = (await p().query(`SELECT status FROM production_plan_items WHERE id = $1`, [item.id])).rows[0].status;
    expect(st).toBe('produced');
  });

  it('sans règle d\'approbation : la confirmation passe sans demande', async () => {
    const planId = await newPlan();
    await expect(gates.gateApproval({ docType: 'production_order', docId: planId, docLabel: 'Ordre test', values: { planned_qty: 2, items: 1, estimated_cost: 10 }, userId: fx.userId }))
      .resolves.toBeUndefined();
    expect((await p().query(`SELECT 1 FROM approval_requests WHERE doc_id = $1`, [planId])).rows).toHaveLength(0);
  });

  it('avec une règle : demande créée, refus tant qu\'elle attend, approuvée → ordre confirmé', async () => {
    ruleId = (await p().query(
      `INSERT INTO approval_rules (code, label, doc_type, condition) VALUES ($1, 'Gros ordre', 'production_order', '{"field":"planned_qty","op":"gte","value":1}') RETURNING id`,
      [`e6_${RUN}`.slice(0, 40).toLowerCase().replace(/[^a-z0-9_]/g, '_')])).rows[0].id;
    await p().query(`INSERT INTO approval_rule_steps (rule_id, step_order, approver_role) VALUES ($1, 1, 'admin')`, [ruleId]);

    // Un administrateur est l'approbateur final : sa propre action vaut approbation. Demandeur : un gérant.
    manager = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role, store_id) VALUES ($1, 'x', 'Gérant', 'E6', 'manager', $2) RETURNING id`,
      [`manager-e6-${RUN}@test.local`, fx.storeId])).rows[0].id;
    const planId = await newPlan();
    const values = await gates.planApprovalValues(planId);
    expect(values.planned_qty).toBe(2);
    const input = { docType: 'production_order', docId: planId, docLabel: values.label, values: { planned_qty: values.planned_qty, items: values.items, estimated_cost: values.estimated_cost }, userId: manager };
    await expect(gates.gateApproval(input)).rejects.toMatchObject({ code: 'APPROVAL_PENDING', statusCode: 409 });
    await expect(gates.gateApproval(input)).rejects.toThrow(/en attente/);
    const req = (await p().query(`SELECT id FROM approval_requests WHERE doc_type = 'production_order' AND doc_id = $1 AND status = 'pending'`, [planId])).rows[0];
    await approvals.decide(req.id, { userId: fx.userId, role: 'admin' }, 'approve');
    const plan = (await p().query(`SELECT status FROM production_plans WHERE id = $1`, [planId])).rows[0];
    expect(['confirmed', 'awaiting_ingredients']).toContain(plan.status);
    await expect(gates.gateApproval(input)).resolves.toBeUndefined();
  });

  it('une non-conformité reçoit un numéro de la série NC', async () => {
    const nc = await quality.createNonConformity({ title: `NC étape 6 ${RUN}`, severity: 'low', userId: fx.userId, storeId: fx.storeId });
    ncIds.push(nc.id);
    const row = (await p().query(`SELECT nc_number FROM quality_nonconformities WHERE id = $1`, [nc.id])).rows[0];
    expect(row.nc_number).toMatch(/^NC-\d{4}-\d{5}$/);
  });
});
