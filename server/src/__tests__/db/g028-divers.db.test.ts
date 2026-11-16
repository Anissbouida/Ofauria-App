/**
 * G0-28 — divers.
 *  - TRS : un jour d'arrêt total (aucune étape terminée) compte dans le temps planifié ;
 *    un arrêt est compté pour sa part qui chevauche la période.
 *  - Tâches planifiées : elles agissent au nom de l'utilisateur technique « Système »,
 *    absent de la liste des utilisateurs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Divers (G0-28)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fx: Fixtures;
  let workCenterId: string;
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    fx = await createBaseFixtures();
    workCenterId = (await p().query(
      `INSERT INTO work_centers (name, capacity_minutes_per_day, store_id, created_by) VALUES ($1, 480, $2, $3) RETURNING id`,
      [`Four G028 ${RUN}`, fx.storeId, fx.userId])).rows[0].id;
    // Arrêt du 2027-11-03 de 08:00 à 12:00 (heure de Casablanca), aucune étape terminée ce jour-là.
    await p().query(
      `INSERT INTO work_center_downtime (work_center_id, from_time, to_time, reason) VALUES ($1, '2027-11-03 08:00+01', '2027-11-03 12:00+01', 'panne')`,
      [workCenterId]);
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM work_center_downtime WHERE work_center_id = $1`, [workCenterId]).catch(() => undefined);
    await p().query(`DELETE FROM work_centers WHERE id = $1`, [workCenterId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('TRS : le jour d\'arrêt sans production entre dans le temps planifié', async () => {
    const { routingRepository } = await import('../../repositories/routing.repository.js');
    const oee = await routingRepository.getOee(workCenterId, '2027-11-01T00:00:00+01:00', '2027-11-08T00:00:00+01:00');
    // Avant : 0 jour actif, temps planifié 0, disponibilité indéfinie.
    expect(oee).toMatchObject({ active_days: 1, planned_min: 480, downtime_min: 240, availability_pct: 50 });
  });

  it('TRS : un arrêt commencé avant la période ne compte que pour sa part dans la période', async () => {
    const { routingRepository } = await import('../../repositories/routing.repository.js');
    const oee = await routingRepository.getOee(workCenterId, '2027-11-03T10:00:00+01:00', '2027-11-04T00:00:00+01:00');
    expect(oee).toMatchObject({ downtime_min: 120, planned_min: 480 });      // 10:00 → 12:00 seulement
    const outside = await routingRepository.getOee(workCenterId, '2027-11-04T00:00:00+01:00', '2027-11-05T00:00:00+01:00');
    expect(outside).toMatchObject({ downtime_min: 0, active_days: 0 });
  });

  it('utilisateur technique « Système » : un compte inactif, hors de la liste des utilisateurs', async () => {
    const { systemUserId } = await import('../../services/system-user.js');
    const { userRepository } = await import('../../repositories/user.repository.js');
    const id = await systemUserId();
    const row = (await p().query(`SELECT is_active, is_system, pin_code FROM users WHERE id = $1`, [id])).rows[0];
    expect(row).toEqual({ is_active: false, is_system: true, pin_code: null });
    expect((await userRepository.findAll()).some(u => u.id === id)).toBe(false);
    expect((await p().query(`SELECT count(*)::int AS n FROM users WHERE is_system`)).rows[0].n).toBe(1);
  });
});
