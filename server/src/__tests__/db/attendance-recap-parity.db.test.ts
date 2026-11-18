/**
 * M8-05 — le récapitulatif mensuel du pointage (calculé au serveur) compte les mêmes jours
 * que le bulletin : pointage réel seulement, demi-journée = 0,5, shift double couvert une
 * fois et payé en plus, base 26. Avant, l'écran recalculait avec une autre formule.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Récapitulatif de pointage = bulletin (M8-05)', () => {
  let fx: Fixtures;
  let empId = '';
  let mod: typeof import('../../repositories/payroll-config.repository.js');

  beforeAll(async () => {
    await importRepositories();
    mod = await import('../../repositories/payroll-config.repository.js');
    fx = await createBaseFixtures();
    const p = testPool();
    empId = (await p.query(
      `INSERT INTO employees (first_name, last_name, role, hire_date, pay_frequency, monthly_salary, is_active, store_id)
       VALUES ('Recap', $1, 'cashier', '2025-01-01', 'monthly', 5200, true, $2) RETURNING id`, [`M805-${RUN}`, fx.storeId])).rows[0].id;
    // Mars 2026 : 18 présents, 2 retards, 2 doubles, 3 demi-journées, 1 absent, + 1 ligne prévue (ignorée).
    const days: [number, string, boolean][] = [];
    for (let d = 1; d <= 18; d++) days.push([d, 'present', false]);
    days.push([19, 'late', false], [20, 'late', false], [21, 'double', false], [22, 'double', false]);
    days.push([23, 'half_day', false], [24, 'half_day', false], [25, 'half_day', false], [26, 'absent', false], [27, 'present', true]);
    for (const [d, status, expected] of days) {
      await p.query(`INSERT INTO attendance (employee_id, date, status, is_expected) VALUES ($1, $2::date, $3, $4)`,
        [empId, `2026-03-${String(d).padStart(2, '0')}`, status, expected]);
    }
  }, 60_000);

  afterAll(async () => {
    const p = testPool();
    const run = async (sql: string, params: unknown[]) => { try { await p.query(sql, params); } catch { /* best effort */ } };
    await run(`DELETE FROM payroll WHERE employee_id = $1`, [empId]);
    await run(`DELETE FROM attendance WHERE employee_id = $1`, [empId]);
    await run(`DELETE FROM employees WHERE id = $1`, [empId]);
    await run(`DELETE FROM users WHERE id = $1`, [fx.userId]);
    await run(`DELETE FROM stores WHERE id = $1`, [fx.storeId]);
    await closeTestPool();
  }, 60_000);

  it('mêmes jours travaillés et absences que le bulletin', async () => {
    const recap = await mod.monthlyAttendanceRecap(3, 2026, fx.storeId);
    const row = recap.rows.find(r => r.employeeId === empId)!;
    expect(row).toMatchObject({ present: 18, late: 2, double: 2, halfDay: 3, absentMarked: 1 });

    const emp = (await testPool().query(`SELECT * FROM employees WHERE id = $1`, [empId])).rows[0];
    const slip = await mod.computeAndSavePayslip(emp, 3, 2026, await mod.loadPayrollContext(3, 2026)) as Record<string, unknown>;
    expect(row.workedDays).toBe(Number(slip.worked_days));
    expect(row.absentDays).toBe(Number(slip.absent_days));
  });
});
