/**
 * G0-09 (plan d'action 2026-11) — un pointage manuel sans heure d'arrivée survit
 * au ré-enregistrement du planning et reste compté par la paie.
 *
 * Avant : bulkUpsertWeek repassait « attendu » (is_expected = true) toute ligne
 * sans heure ; la paie, qui ne lit que is_expected = false, perdait le jour.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, TEST_DATABASE_URL, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Pointage et planning (G0-09)', () => {
  const p = () => testPool();
  let scheduleRepository: typeof import('../../repositories/employee.repository.js')['scheduleRepository'];
  let attendanceRepository: typeof import('../../repositories/employee.repository.js')['attendanceRepository'];
  let employeeId: string, userId: string;
  const MON = '2026-03-02', TUE = '2026-03-03', WED = '2026-03-04', THU = '2026-03-05';

  /** Jours que la paie compterait (même filtre que computeAndSavePayslip). */
  const paidDays = async () => (await p().query(
    `SELECT COUNT(*) FILTER (WHERE status IN ('present', 'late', 'repos'))::int AS n
       FROM attendance WHERE employee_id = $1 AND date BETWEEN $2 AND $3 AND is_expected = false`,
    [employeeId, MON, THU])).rows[0].n as number;
  const row = async (date: string) => (await p().query(
    `SELECT status, is_expected, check_in, updated_by FROM attendance WHERE employee_id = $1 AND date = $2`, [employeeId, date])).rows[0];
  const plan = (dates: string[]) => scheduleRepository.bulkUpsertWeek(dates.map(date => ({ employeeId, date, shiftCode: 'SALES_AM' })));

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
    ({ scheduleRepository, attendanceRepository } = await import('../../repositories/employee.repository.js'));
    userId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,'x','G','Rh','admin') RETURNING id`, [`g009-${RUN}@test.local`])).rows[0].id;
    employeeId = (await p().query(`INSERT INTO employees (first_name, last_name, role, hire_date, monthly_salary) VALUES ('Sara',$1,'saleswoman','2025-01-01',4000) RETURNING id`, [`G009 ${RUN}`])).rows[0].id;
  });

  afterAll(async () => {
    await p().query(`DELETE FROM attendance WHERE employee_id = $1`, [employeeId]).catch(() => undefined);
    await p().query(`DELETE FROM schedules WHERE employee_id = $1`, [employeeId]).catch(() => undefined);
    await p().query(`DELETE FROM employees WHERE id = $1`, [employeeId]).catch(() => undefined);
    await p().query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
    await closeTestPool();
  });

  it('le planning pré-remplit des présences attendues, non comptées par la paie', async () => {
    await plan([MON, TUE, WED, THU]);
    expect(await row(MON)).toMatchObject({ status: 'present', is_expected: true, check_in: null });
    expect(await paidDays()).toBe(0);
  });

  it('un pointage manuel sans heure survit à deux ré-enregistrements du planning', async () => {
    // Lundi : présent sans heure. Mardi : repos payé. Mercredi : absent.
    await attendanceRepository.upsert({ employeeId, date: MON, status: 'present' }, userId);
    await attendanceRepository.upsert({ employeeId, date: TUE, status: 'repos' }, userId);
    await attendanceRepository.upsert({ employeeId, date: WED, status: 'absent' }, userId);
    expect(await paidDays()).toBe(2);

    await plan([MON, TUE, WED, THU]);
    await plan([MON, TUE, WED, THU]);

    expect(await row(MON)).toMatchObject({ status: 'present', is_expected: false, check_in: null });
    expect(await row(TUE)).toMatchObject({ status: 'repos', is_expected: false });
    // L'absence décidée par le gérant reste une absence réelle, pas une présence attendue.
    expect(await row(WED)).toMatchObject({ status: 'absent', is_expected: false });
    // Jeudi, jamais pointé : toujours une simple présence attendue.
    expect(await row(THU)).toMatchObject({ status: 'present', is_expected: true });
    expect(await paidDays()).toBe(2);
  });

  it('le pointage garde la trace de qui l\'a saisi', async () => {
    expect((await row(MON)).updated_by).toBe(userId);
  });

  it('un jour passé en repos au planning retire la présence attendue, jamais un pointage réel', async () => {
    await scheduleRepository.bulkUpsertWeek([
      { employeeId, date: THU, shiftCode: null }, { employeeId, date: MON, shiftCode: null },
    ]);
    expect(await row(THU)).toBeUndefined();
    expect(await row(MON)).toMatchObject({ status: 'present', is_expected: false });
  });
});
