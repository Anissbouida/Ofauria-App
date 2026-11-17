/**
 * M5-04 — calendrier des postes (mig 568).
 * Four ouvert du lundi au vendredi, 06:00-14:00, 2 ressources (960 min/jour) ; un jour fermé.
 *  - sans calendrier : capacité journalière du poste (comportement historique) ;
 *  - avec calendrier : 960 un lundi, 0 un dimanche, 0 le jour fermé ;
 *  - TRS : temps planifié = temps d'ouverture de la semaine (4 jours ouvrés × 960, un jour fermé).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Calendrier des postes (M5-04)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let rr: typeof import('../../repositories/routing.repository.js')['routingRepository'];
  let fx: Fixtures; let wcId: string; let closureId: string;
  const p = () => testPool();
  // Semaine fixe : lundi 2026-11-02 … dimanche 2026-11-08 ; mercredi 04 fermé.
  const MONDAY = '2026-11-02';

  beforeAll(async () => {
    repos = await importRepositories();
    rr = (await import('../../repositories/routing.repository.js')).routingRepository;
    fx = await createBaseFixtures();
    wcId = (await rr.createWorkCenter({ name: `Four M504 ${RUN}`, hourlyCost: 30, capacityMinutesPerDay: 480, userId: fx.userId })).id;
  }, 60_000);

  afterAll(async () => {
    if (closureId) await rr.removeClosure(closureId).catch(() => undefined);
    if (wcId) { await rr.setCalendar(wcId, []).catch(() => undefined); await p().query(`UPDATE work_centers SET is_active = false WHERE id = $1`, [wcId]).catch(() => undefined); }
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('sans calendrier : capacité journalière du poste', async () => {
    expect(await rr.capacityOn(wcId, MONDAY)).toBe(480);
    expect(await rr.capacityOn(wcId, '2026-11-08')).toBe(480);
  });

  it('avec calendrier : plages × ressources, dimanche et jour fermé à 0', async () => {
    await rr.setCalendar(wcId, [1, 2, 3, 4, 5].map(d => ({ isoWeekday: d, startTime: '06:00', endTime: '14:00', resources: 2 })));
    closureId = (await rr.addClosure(wcId, '2026-11-04', 'Maintenance four')).id;
    expect(await rr.capacityOn(wcId, MONDAY)).toBe(960);
    expect(await rr.capacityOn(wcId, '2026-11-08')).toBe(0);
    expect(await rr.capacityOn(wcId, '2026-11-04')).toBe(0);
    const cal = await rr.getCalendar(wcId);
    expect(cal.slots).toHaveLength(5);
    expect(cal.slots[0]).toMatchObject({ iso_weekday: 1, start_time: '06:00', end_time: '14:00', resources: 2 });
  });

  it('TRS : temps planifié = temps d\'ouverture du calendrier', async () => {
    const oee = await rr.getOee(wcId, '2026-11-02T00:00:00+01:00', '2026-11-09T00:00:00+01:00');
    expect(oee.from_calendar).toBe(true);
    expect(oee.planned_min).toBe(4 * 960);
  });
});
