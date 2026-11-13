/**
 * Mise en route guidée (P9) : les tâches d'un module se cochent d'après les données ;
 * une liste terminée disparaît ; masquer une liste n'affecte pas le bilan de santé.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories } from './helpers.js';

describe.skipIf(!hasTestDb)('Mise en route guidée', () => {
  let ob: typeof import('../../services/module-onboarding.js');
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let savedWorkshops: { code: string; is_active: boolean; is_default: boolean }[] = [];
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    ob = await import('../../services/module-onboarding.js');
    savedWorkshops = (await p().query(`SELECT code, is_active, is_default FROM production_workshops`)).rows;
    await ob.showAllOnboarding();
  });

  afterAll(async () => {
    for (const s of savedWorkshops) {
      await p().query(`UPDATE production_workshops SET is_active = $2, is_default = $3 WHERE code = $1`, [s.code, s.is_active, s.is_default]).catch(() => undefined);
    }
    await ob?.showAllOnboarding().catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('une tâche se coche d\'après les données, et une liste terminée disparaît', async () => {
    const production = async () => (await ob.onboardingReport()).modules.find(m => m.module === 'production');
    const workshopTask = async () => (await production())?.tasks.find(t => t.key === 'production.workshop');

    await p().query(`UPDATE production_workshops SET is_active = false, is_default = false`);
    expect(await workshopTask()).toMatchObject({ done: false, to: '/settings?page=production' });

    for (const s of savedWorkshops) await p().query(`UPDATE production_workshops SET is_active = $2 WHERE code = $1`, [s.code, s.is_active]);
    const list = await production();
    // Soit la liste reste (autres tâches à faire) avec l'atelier coché, soit elle a disparu car terminée.
    if (list) expect(list.tasks.find(t => t.key === 'production.workshop')?.done).toBe(true);
    for (const m of (await ob.onboardingReport()).modules) expect(m.done).toBeLessThan(m.total);
  });

  it('masquer une liste puis tout réafficher, sans toucher au bilan de santé', async () => {
    await p().query(`UPDATE production_workshops SET is_active = false, is_default = false`);
    expect((await ob.onboardingReport()).modules.map(m => m.module)).toContain('production');

    expect(await ob.hideOnboarding('production')).toBe(true);
    const r = await ob.onboardingReport();
    expect(r.modules.map(m => m.module)).not.toContain('production');
    expect(r.hidden).toBeGreaterThanOrEqual(1);

    // Réafficher les propositions du bilan ne réaffiche pas les listes masquées.
    const health = await import('../../services/config-health.js');
    await health.restoreDismissed();
    expect((await ob.onboardingReport()).modules.map(m => m.module)).not.toContain('production');

    await ob.showAllOnboarding();
    expect((await ob.onboardingReport()).modules.map(m => m.module)).toContain('production');
    expect(await ob.hideOnboarding('inconnu')).toBe(false);
  });
});
