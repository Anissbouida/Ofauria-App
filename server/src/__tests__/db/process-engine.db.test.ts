/**
 * Moteur de parcours configurable (plan d'exécution multi-industries, étape 5, mig 639).
 *
 *   - éteint (défaut) : rien ne change, aucun journal ;
 *   - ombre : le code actuel décide, chaque désaccord du moteur est journalisé ;
 *   - actif : les gardes du parcours publié décident ;
 *   - éditeur : catalogue fermé, brouillon validé puis publié ; un parcours « mécanique »
 *     (usinage, contrôle conditionnel, opérations parallèles) se configure sans code.
 */
process.env.POS_ALLOW_NEGATIVE_STOCK = 'off';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, createProductWithRecipe, cleanupFixtures,
  num, RUN, type Fixtures,
} from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe.skipIf(!hasTestDb)('Étape 5 — moteur de parcours', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let policies: any; let models: any; let engine: any;
  let fx: Fixtures; let productId: string;
  let orderType: string; let originalPublished: number;
  const p = () => testPool();
  const planIds: string[] = [];

  async function resetPolicies() {
    await p().query(`DELETE FROM policy_values WHERE key IN ('production.enforce_declared_steps', 'production.process_engine')`);
    policies.invalidatePolicies();
  }

  beforeAll(async () => {
    repos = await importRepositories();
    policies = await import('../../services/policies.js');
    models = (await import('../../repositories/process-model.repository.js')).processModelRepository;
    engine = await import('../../services/process-engine.js');
    await resetPolicies();
    orderType = (await p().query(`SELECT code FROM production_order_types WHERE is_default LIMIT 1`)).rows[0].code;
    originalPublished = (await p().query(`SELECT id FROM process_models WHERE order_type_code = $1 AND status = 'publie'`, [orderType])).rows[0].id;
    await p().query(`DELETE FROM process_models WHERE order_type_code = $1 AND status = 'brouillon'`, [orderType]);
    fx = await createBaseFixtures();
    const farine = await createIngredient(fx, { name: 'Farine moteur', unit: 'kg', unitCost: 10 });
    await createLot(fx, { ingredientId: farine, lotNumber: 'MOT', pesage: 100, expiresInDays: 30, unitCost: 10 });
    productId = (await createProductWithRecipe(fx, { name: 'Pain moteur', price: 2, ingredients: [{ ingredientId: farine, quantity: 0.5, unit: 'kg' }] })).productId;
  }, 60_000);

  afterAll(async () => {
    await resetPolicies().catch(() => undefined);
    if (originalPublished) {
      await p().query(`DELETE FROM process_models WHERE order_type_code = $1 AND id <> $2`, [orderType, originalPublished]).catch(() => undefined);
      await p().query(`UPDATE process_models SET status = 'publie' WHERE id = $1`, [originalPublished]).catch(() => undefined);
    }
    if (planIds.length) await p().query(`DELETE FROM process_shadow_log WHERE plan_id = ANY($1::uuid[])`, [planIds]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  /** Ordre confirmé, bon de sortie clôturé, lignes NON pesées (la pesée obligatoire refuse). */
  async function planReadyButUnweighed() {
    const plan = await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId, plannedQuantity: 2 }],
    });
    fx.ids.plans.push(plan.id); planIds.push(plan.id);
    await repos.productionRepository.confirm(plan.id, fx.userId);
    const bon = (await repos.bonSortieRepository.findByPlan(plan.id))[0];
    await repos.bonSortieRepository.markAsPreparation(bon.id, fx.userId);
    const fresh = (await repos.bonSortieRepository.findByPlan(plan.id))[0];
    await repos.bonSortieRepository.weighLignes(bon.id, fx.userId, (fresh.lines as any[]).filter(l => num(l.allocated_quantity) > 0)
      .map(l => ({ ligneId: l.id, actualQuantity: num(l.allocated_quantity), source: 'manual' })));
    await repos.bonSortieRepository.markAsReady(bon.id, fx.userId);
    await repos.bonSortieRepository.acceptReception(bon.id, fx.userId);
    await p().query(`UPDATE production_bons_sortie_lignes SET weighed_at = NULL WHERE bon_id = $1`, [bon.id]);
    return plan.id as string;
  }
  const shadowRows = async (planId: string) =>
    (await p().query(`SELECT * FROM process_shadow_log WHERE plan_id = $1`, [planId])).rows;

  /** Publie une copie du parcours standard sans la garde « toutes les lignes pesées ». */
  async function publishWithoutWeighingGuard() {
    const std = await models.get(originalPublished);
    const stages = std.stages.map((s: any) => ({ ...s, guards: s.guards.filter((g: string) => g !== 'all_weighed') }));
    const r = await models.saveDraft(orderType, { label: `Sans pesée ${RUN}`, stages }, fx.userId);
    expect(r.error).toBeUndefined();
    const pub = await models.publish(r.model.id);
    expect(pub.model.status).toBe('publie');
  }

  it('le parcours standard publié reproduit les gardes du type d\'ordre', async () => {
    const std = await models.get(originalPublished);
    const fab = std.stages.find((s: any) => s.code === 'fabrication');
    expect(fab.guards).toContain('semi_finished_ready');
    expect(fab.techStatus).toBe('in_progress');
  });

  it('éteint (défaut) : aucun journal, le code actuel décide', async () => {
    await policies.setPolicy('production.enforce_declared_steps', 'company', '', { enabled: true }, fx.userId);
    const planId = await planReadyButUnweighed();
    expect(await engine.engineMode(planId)).toBe('eteint');
    await expect(repos.productionRepository.start(planId, fx.userId)).rejects.toThrow(/Pesée obligatoire/);
    expect(await shadowRows(planId)).toHaveLength(0);
  });

  it('ombre : même décision = pas de journal ; désaccord = journal, le code actuel décide', async () => {
    await policies.setPolicy('production.process_engine', 'company', '', { mode: 'ombre' }, fx.userId);
    const agree = await planReadyButUnweighed();
    await expect(repos.productionRepository.start(agree, fx.userId)).rejects.toThrow(/Pesée obligatoire/);
    expect(await shadowRows(agree)).toHaveLength(0);

    await publishWithoutWeighingGuard();
    const disagree = await planReadyButUnweighed();
    await expect(repos.productionRepository.start(disagree, fx.userId)).rejects.toThrow(/Pesée obligatoire/);
    const log = await shadowRows(disagree);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ transition: 'fabrication', engine_allows: true, legacy_allows: false });
    expect((await models.shadowLog()).some((r: any) => r.plan_id === disagree)).toBe(true);
  });

  it('actif : les gardes du parcours publié décident', async () => {
    await policies.setPolicy('production.process_engine', 'company', '', { mode: 'actif' }, fx.userId);
    const planId = await planReadyButUnweighed();
    await expect(repos.productionRepository.start(planId, fx.userId)).resolves.toBeUndefined();
    const st = (await p().query(`SELECT status FROM production_plans WHERE id = $1`, [planId])).rows[0].status;
    expect(st).toBe('in_progress');
    const prog = await engine.planProgress(planId);
    expect(prog.stages.find((s: any) => s.code === 'fabrication').state).toBe('courant');
    expect(prog.stages.find((s: any) => s.code === 'planification').state).toBe('fait');
  });

  it('l\'éditeur refuse un parcours hors catalogue ou incohérent', async () => {
    const bad = await models.saveDraft(orderType, { stages: [
      { code: 'debut', label: 'Début', techStatus: 'draft' },
      { code: 'fin', label: 'Fin', techStatus: 'completed', guards: ['sql_libre'] },
      { code: 'retour', label: 'Retour', techStatus: 'in_progress' },
    ] });
    expect(bad.error).toBe('Parcours invalide');
    expect(bad.details.join(' ')).toMatch(/garde inconnue/);
    expect(bad.details.join(' ')).toMatch(/revenir en arrière/);
    const unknownType = await models.saveDraft('type_inexistant', { stages: [] });
    expect(unknownType.error).toMatch(/inconnu/);
  });

  it('un parcours « mécanique » se configure sans code (conditions, groupe parallèle)', async () => {
    const r = await models.saveDraft(orderType, { label: 'Usinage', stages: [
      { code: 'planification', label: 'Planification', techStatus: 'draft', documentKey: 'ordre_fabrication' },
      { code: 'lancement', label: 'Lancement atelier', techStatus: 'confirmed', actions: ['notify_workshop'] },
      { code: 'usinage', label: 'Usinage', techStatus: 'in_progress', guards: ['semi_finished_ready'], parallelGroup: 'operations' },
      { code: 'traitement', label: 'Traitement de surface', techStatus: 'in_progress', parallelGroup: 'operations' },
      { code: 'cloture', label: 'Clôture', techStatus: 'completed', actions: ['create_product_lot', 'compute_cost'] },
      { code: 'controle_final', label: 'Contrôle final', techStatus: 'completed', guards: ['quality_passed'], conditionKey: 'has_quality_plan', documentKey: 'certificat_conformite' },
      { code: 'expedition', label: 'Expédition', techStatus: 'completed', actions: ['transfer_to_store'], documentKey: 'bon_transfert' },
    ] }, fx.userId);
    expect(r.error).toBeUndefined();
    expect(r.model.stages).toHaveLength(7);
    const pub = await models.publish(r.model.id);
    expect(pub.model.status).toBe('publie');
    const hist = await models.history(orderType);
    expect(hist.filter((h: any) => h.status === 'publie')).toHaveLength(1);

    // Ordre lancé : les deux opérations du groupe parallèle sont courantes ensemble ;
    // le contrôle final, sans contrôle prévu sur l'ordre, est sauté.
    const planId = await planReadyButUnweighed();
    await repos.productionRepository.start(planId, fx.userId);
    const prog = await engine.planProgress(planId);
    const state = (c: string) => prog.stages.find((s: any) => s.code === c).state;
    expect(prog.model.label).toBe('Usinage');
    expect(state('usinage')).toBe('courant');
    expect(state('traitement')).toBe('courant');
    expect(state('controle_final')).toBe('saute');
    expect(state('expedition')).toBe('a_venir');

    // Groupe parallèle non contigu : refusé.
    const split = await models.saveDraft(orderType, { stages: [
      { code: 'a', label: 'A', techStatus: 'draft' },
      { code: 'b', label: 'B', techStatus: 'in_progress', parallelGroup: 'g' },
      { code: 'c', label: 'C', techStatus: 'in_progress' },
      { code: 'd', label: 'D', techStatus: 'in_progress', parallelGroup: 'g' },
      { code: 'e', label: 'E', techStatus: 'completed' },
    ] });
    expect(split.details.join(' ')).toMatch(/doivent se suivre/);
  });
});
