/**
 * G1-05 — interrupteurs de production effectifs.
 *  - la migration 537 les a alignés sur la réalité : étapes, rendement et coût ACTIVÉS ;
 *  - « Coût de revient » coupé : le calcul d'un plan et le calcul groupé sont refusés (409) ;
 *  - « Rendement » coupé : la saisie du rendement est refusée (409) ;
 *  - « Étapes » coupé : les étapes ne bloquent plus, même si « étapes bloquantes » est à oui ;
 *  - rétabli : plus aucun refus.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories } from './helpers.js';

describe.skipIf(!hasTestDb)('Interrupteurs de production (G1-05)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let settings: typeof import('../../repositories/settings.repository.js')['settingsRepository'];
  let coutCtl: typeof import('../../controllers/production-cout.controller.js')['productionCoutController'];
  let etapesCtl: typeof import('../../controllers/production-etapes.controller.js')['productionEtapesController'];
  let previous: Record<string, unknown>;
  const p = () => testPool();
  const NONE = '00000000-0000-0000-0000-000000000000';

  const set = (steps: boolean, yieldOn: boolean, cost: boolean, blocking = false) => p().query(
    `UPDATE company_settings SET production_steps_enabled = $1, production_yield_enabled = $2,
            production_cost_enabled = $3, production_steps_blocking = $4 WHERE id = 1`, [steps, yieldOn, cost, blocking]);
  /** Appelle un contrôleur avec une fausse réponse et rend { status, body }. */
  const call = async (fn: (req: never, res: never) => Promise<void>, req: Record<string, unknown>) => {
    const out = { status: 200, body: undefined as { success?: boolean; error?: { message: string } } | undefined };
    const res = { status(code: number) { out.status = code; return res; }, json(body: typeof out.body) { out.body = body; return res; } };
    await fn({ user: { userId: NONE }, params: {}, body: {}, query: {}, ...req } as never, res as never);
    return out;
  };
  const rendement = { quantite_brute: 10, quantite_nette_reelle: 10, vers_magasin: 10 };

  beforeAll(async () => {
    repos = await importRepositories();
    ({ settingsRepository: settings } = await import('../../repositories/settings.repository.js'));
    ({ productionCoutController: coutCtl } = await import('../../controllers/production-cout.controller.js'));
    ({ productionEtapesController: etapesCtl } = await import('../../controllers/production-etapes.controller.js'));
    previous = (await p().query(
      `SELECT production_steps_enabled, production_yield_enabled, production_cost_enabled, production_steps_blocking
         FROM company_settings WHERE id = 1`)).rows[0];
  }, 60_000);

  afterAll(async () => {
    if (previous) await set(previous.production_steps_enabled as boolean, previous.production_yield_enabled as boolean,
      previous.production_cost_enabled as boolean, previous.production_steps_blocking as boolean).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('migration 537 : les trois fonctions sont activées, et le restent par défaut', async () => {
    expect(previous).toMatchObject({ production_steps_enabled: true, production_yield_enabled: true, production_cost_enabled: true });
    const defaults = (await p().query(
      `SELECT column_name, column_default FROM information_schema.columns
        WHERE table_name = 'company_settings' AND column_name IN ('production_steps_enabled', 'production_yield_enabled', 'production_cost_enabled')`)).rows;
    expect(defaults).toHaveLength(3);
    expect(defaults.every(d => d.column_default === 'true')).toBe(true);
  });

  it('« Coût de revient » coupé : calcul d\'un plan et calcul groupé refusés', async () => {
    await set(true, true, false);
    expect(await settings.productionFeatures()).toEqual({ steps: true, yield: true, cost: false });
    const one = await call(coutCtl.calculateCost, { params: { planId: NONE } });
    expect(one.status).toBe(409);
    expect(one.body?.error?.message).toMatch(/coût de revient est désactivé/);
    expect((await call(coutCtl.batchCalculate, {})).status).toBe(409);
  });

  it('« Rendement » coupé : saisie refusée ; une saisie mal formée reste une erreur 400', async () => {
    await set(true, false, true);
    const out = await call(etapesCtl.recordRendement, { params: { itemId: NONE }, body: rendement });
    expect(out.status).toBe(409);
    expect(out.body?.error?.message).toMatch(/rendement est désactivée/);
    expect((await call(etapesCtl.recordRendement, { params: { itemId: NONE }, body: {} })).status).toBe(400);
  });

  it('« Étapes » coupé : rien ne bloque, même avec « étapes bloquantes » à oui', async () => {
    const blocking = async () => (await p().query(
      `SELECT (production_steps_blocking AND production_steps_enabled) AS b FROM company_settings LIMIT 1`)).rows[0].b;
    await set(false, true, true, true);
    expect(await blocking()).toBe(false);
    expect((await settings.productionFeatures()).steps).toBe(false);
    await set(true, true, true, true);
    expect(await blocking()).toBe(true);
  });

  it('tout rétabli : plus de refus (le calcul d\'un plan inconnu échoue autrement que par un 409)', async () => {
    await set(true, true, true);
    expect(await settings.productionFeatures()).toEqual({ steps: true, yield: true, cost: true });
    const out = await call(coutCtl.calculateCost, { params: { planId: NONE } }).catch(() => ({ status: 500 }));
    expect(out.status).not.toBe(409);
  }, 120_000);
});
