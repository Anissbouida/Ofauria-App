/**
 * Scénario E — configuration changée en cours d'exploitation (plan d'exécution
 * multi-industries, étape 4, mig 638).
 *
 *   - à la confirmation, l'ordre fige ses réglages d'exécution (type d'ordre, politiques,
 *     version de configuration) ;
 *   - une politique publiée ensuite ne change rien à l'ordre déjà confirmé ; un nouvel ordre
 *     prend la nouvelle valeur ;
 *   - une version de configuration porte toutes les couches ; deux versions se comparent ;
 *     la restauration remet le vocabulaire de la société.
 */
process.env.POS_ALLOW_NEGATIVE_STOCK = 'off';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, createProductWithRecipe, cleanupFixtures,
  num, RUN, type Fixtures,
} from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe.skipIf(!hasTestDb)('Scénario E — configuration figée sur l\'ordre', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let sectors: any; let policies: any;
  let fx: Fixtures; let productId: string;
  const p = () => testPool();
  const labelKey = `cfgfreeze_${RUN}`.slice(0, 50);

  beforeAll(async () => {
    repos = await importRepositories();
    sectors = (await import('../../repositories/sector.repository.js')).sectorRepository;
    policies = await import('../../services/policies.js');
    await p().query(`DELETE FROM policy_values WHERE key = 'production.enforce_declared_steps'`);
    policies.invalidatePolicies();
    fx = await createBaseFixtures();
    const farine = await createIngredient(fx, { name: 'Farine cfg', unit: 'kg', unitCost: 10 });
    await createLot(fx, { ingredientId: farine, lotNumber: 'CFG', pesage: 100, expiresInDays: 30, unitCost: 10 });
    productId = (await createProductWithRecipe(fx, { name: 'Pain cfg', price: 2, ingredients: [{ ingredientId: farine, quantity: 0.5, unit: 'kg' }] })).productId;
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM policy_values WHERE key = 'production.enforce_declared_steps'`).catch(() => undefined);
    policies?.invalidatePolicies();
    await p().query(`DELETE FROM company_label_overrides WHERE label_key = $1`, [labelKey]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  async function confirmedPlanWithUnweighedBsi() {
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
    await p().query(`UPDATE production_bons_sortie_lignes SET weighed_at = NULL WHERE bon_id = $1`, [bon.id]);
    return plan.id as string;
  }

  it('la confirmation fige les réglages d\'exécution et la version de configuration', async () => {
    const planId = await confirmedPlanWithUnweighedBsi();
    const row = (await p().query(`SELECT exec_snapshot, config_version_id FROM production_plans WHERE id = $1`, [planId])).rows[0];
    expect(row.exec_snapshot.order_type).toMatchObject({ requires_bon_sortie: true, consumption_mode: expect.any(String) });
    expect(row.exec_snapshot.policies['production.enforce_declared_steps']).toEqual({ enabled: false });
    // Une politique publiée APRÈS la confirmation ne change rien à cet ordre.
    await policies.setPolicy('production.enforce_declared_steps', 'company', '', { enabled: true }, fx.userId);
    await expect(repos.productionRepository.start(planId, fx.userId)).resolves.toBeUndefined();
  });

  it('un ordre confirmé après la publication prend la nouvelle valeur', async () => {
    const planId = await confirmedPlanWithUnweighedBsi();
    const row = (await p().query(`SELECT exec_snapshot FROM production_plans WHERE id = $1`, [planId])).rows[0];
    expect(row.exec_snapshot.policies['production.enforce_declared_steps']).toEqual({ enabled: true });
    await expect(repos.productionRepository.start(planId, fx.userId)).rejects.toThrow(/Pesée obligatoire/);
  });

  it('une version porte toutes les couches ; deux versions se comparent ; la restauration remet le vocabulaire', async () => {
    await sectors.recordVersion(`Avant vocabulaire ${RUN}`, fx.userId);
    const before = (await p().query(`SELECT max(id)::int AS id FROM config_versions`)).rows[0].id;
    const snap = (await p().query(`SELECT snapshot FROM config_versions WHERE id = $1`, [before])).rows[0].snapshot;
    for (const layer of ['labels', 'specializations', 'order_types', 'workshops', 'units']) expect(snap.layers).toHaveProperty(layer);

    await sectors.setLabelOverride(labelKey, 'Terme test', fx.userId);
    await sectors.recordVersion(`Après vocabulaire ${RUN}`, fx.userId);
    const after = (await p().query(`SELECT max(id)::int AS id FROM config_versions`)).rows[0].id;
    const cmp = await sectors.compareVersions(before, after);
    const labels = cmp.layers.find((l: any) => l.layer === 'labels');
    expect(labels.added).toEqual([{ key: labelKey, value: 'Terme test' }]);

    const r = await sectors.restoreVersion(before, fx.userId);
    expect('error' in r).toBe(false);
    expect((await p().query(`SELECT 1 FROM company_label_overrides WHERE label_key = $1`, [labelKey])).rows).toHaveLength(0);
  });
});
