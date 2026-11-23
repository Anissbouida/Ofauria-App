/**
 * Assistant de configuration et simulation (plan d'exécution multi-industries, étape 11).
 *
 *   - huit étapes, chacune avec son état et l'écran qui la règle ;
 *   - simulation : ordre fictif déroulé de bout en bout dans une transaction annulée — aucune
 *     matière, aucun lot, aucun ordre, aucun article ne reste ; rapport étape par étape ;
 *   - publication refusée tant qu'un point bloquant subsiste (type d'ordre sans parcours).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, createBaseFixtures, cleanupFixtures, type Fixtures } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe.skipIf(!hasTestDb)('Étape 11 — assistant et simulation', () => {
  let setup: any; let fx: Fixtures;
  const p = () => testPool();
  const counts = async () => (await p().query(
    `SELECT (SELECT count(*) FROM ingredients WHERE name = 'Matière de simulation')::int AS ing,
            (SELECT count(*) FROM ingredient_lots WHERE lot_number = 'SIMULATION')::int AS lots,
            (SELECT count(*) FROM products WHERE name = 'Article de simulation')::int AS products,
            (SELECT count(*) FROM production_plans)::int AS plans`)).rows[0];

  beforeAll(async () => {
    setup = await import('../../services/production-setup.js');
    fx = await createBaseFixtures();
  }, 60_000);
  afterAll(async () => {
    await p().query(`DELETE FROM module_parameters WHERE key = 'production.setup_last_simulation'`).catch(() => undefined);
    await p().query(`DELETE FROM process_models WHERE order_type_code = 'E11_SANS_PARCOURS'`).catch(() => undefined);
    await p().query(`DELETE FROM production_order_types WHERE code = 'E11_SANS_PARCOURS'`).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await closeTestPool();
  });

  it('huit étapes, de « Secteur » à « Publication »', async () => {
    const s = await setup.setupSteps();
    expect(s.steps.map((x: any) => x.key)).toEqual(['secteur', 'specialisations', 'modes', 'capacites', 'processus', 'ecrans', 'simulation', 'publication']);
  });

  it('simulation de bout en bout dans une transaction annulée : rien ne reste', async () => {
    const before = await counts();
    const report = await setup.simulateOrder(fx.userId);
    expect(report.steps.map((x: any) => x.step)).toEqual(expect.arrayContaining(['Données de simulation', 'Création de l\'ordre', 'Confirmation', 'Démarrage', 'Déclaration']));
    expect(report.ok, JSON.stringify(report.steps.filter((x: any) => !x.ok))).toBe(true);
    // La pesée a fait sortir 5 kg du lot (mouvement de stock rapporté).
    const pesee = report.steps.find((x: any) => x.step === 'Bon de sortie et pesée');
    if (pesee) expect(pesee.stock).toMatch(/reste 45/);
    expect(await counts()).toEqual(before);
    const saved = (await p().query(`SELECT value FROM module_parameters WHERE key = 'production.setup_last_simulation'`)).rows[0].value;
    expect(saved.ok).toBe(true);
  });

  it('publication refusée tant qu\'un type d\'ordre n\'a pas de parcours publié', async () => {
    await p().query(
      `INSERT INTO production_order_types (code, label, requires_bon_sortie, requires_weighing, requires_quality_check, consumption_mode, is_default, is_active)
       VALUES ('E11_SANS_PARCOURS', 'Type sans parcours', false, false, false, 'a_la_declaration', false, true) ON CONFLICT (code) DO NOTHING`);
    const r = await setup.publishSetup(fx.userId);
    expect(r.error).toMatch(/points bloquants/);
    expect(r.blocking.join(' ')).toMatch(/Type sans parcours/);
    const steps = await setup.setupSteps();
    expect(steps.steps.find((x: any) => x.key === 'processus').status).toBe('bloquant');
  });
});
