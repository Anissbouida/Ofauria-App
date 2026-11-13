/**
 * Bilan de santé de la configuration (P8, mig 516) : des requêtes sur les données
 * proposent un ajustement ou un lien, sans rien appliquer. Une proposition ignorée
 * disparaît 90 jours, puis peut être réaffichée.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories } from './helpers.js';

describe.skipIf(!hasTestDb)('Bilan de santé de la configuration', () => {
  let health: typeof import('../../services/config-health.js');
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let savedWorkshops: { code: string; is_active: boolean; is_default: boolean }[] = [];
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    health = await import('../../services/config-health.js');
    savedWorkshops = (await p().query(`SELECT code, is_active, is_default FROM production_workshops`)).rows;
    await p().query(`UPDATE config_health_dismissals SET dismissed_until = now()`);
  });

  afterAll(async () => {
    for (const s of savedWorkshops) {
      await p().query(`UPDATE production_workshops SET is_active = $2, is_default = $3 WHERE code = $1`, [s.code, s.is_active, s.is_default]).catch(() => undefined);
    }
    await p().query(`UPDATE config_health_dismissals SET dismissed_until = now()`).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('chaque proposition porte un ajustement ou un lien, et ne change rien', async () => {
    const before = (await p().query(`SELECT count(*)::int AS n FROM company_module_settings`)).rows[0].n;
    const { recommendations } = await health.healthReport();
    for (const r of recommendations) {
      expect(health.CHECK_KEYS).toContain(r.key);
      expect(r.title.length).toBeGreaterThan(0);
      if (r.action.kind === 'adjust') expect(Object.keys({ ...r.action.changes.modules, ...r.action.changes.features }).length).toBeGreaterThan(0);
      else expect(r.action.to.startsWith('/')).toBe(true);
    }
    expect((await p().query(`SELECT count(*)::int AS n FROM company_module_settings`)).rows[0].n).toBe(before);
  });

  it('production sans atelier : alerte avec lien, ignorée puis réaffichée', async () => {
    const { sectorRepository } = await import('../../repositories/sector.repository.js');
    const act = await sectorRepository.activation();
    expect(act.modules.has('production')).toBe(true);
    await p().query(`UPDATE production_workshops SET is_active = false, is_default = false`);

    const keyOf = (rs: { key: string }[]) => rs.map(r => r.key);
    const r1 = await health.healthReport();
    const rec = r1.recommendations.find(r => r.key === 'production.no_workshop');
    expect(rec).toMatchObject({ tone: 'warning', action: { kind: 'link', to: '/settings?page=production' } });

    expect(await health.dismissRecommendation('production.no_workshop')).toBe(true);
    const r2 = await health.healthReport();
    expect(keyOf(r2.recommendations)).not.toContain('production.no_workshop');
    expect(r2.dismissed).toBeGreaterThanOrEqual(1);

    await health.restoreDismissed();
    expect(keyOf((await health.healthReport()).recommendations)).toContain('production.no_workshop');
    expect(await health.dismissRecommendation('inconnue')).toBe(false);
  });
});
