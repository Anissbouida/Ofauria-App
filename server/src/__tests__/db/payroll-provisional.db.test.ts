/**
 * G0-10 — un bulletin provisoire (généré avant la fin de la période par
 * dérogation) ne peut pas être payé ; il redevient payable une fois régénéré
 * après la fin de la période. Un bulletin déjà payé ne devient jamais provisoire.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, TEST_DATABASE_URL, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Bulletin provisoire (G0-10)', () => {
  const p = () => testPool();
  let svc: typeof import('../../services/payroll-period.js');
  let employeeId: string, open: string, paid: string, week: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
    svc = await import('../../services/payroll-period.js');
    employeeId = (await p().query(`INSERT INTO employees (first_name, last_name, role, hire_date, monthly_salary) VALUES ('Paie',$1,'baker','2025-01-01',4000) RETURNING id`, [`G010 ${RUN}`])).rows[0].id;
    const ins = (m: number, isPaid: boolean) => p().query(
      `INSERT INTO payroll (employee_id, month, year, base_salary, net_salary, paid) VALUES ($1,$2,2031,4000,3800,$3) RETURNING id`, [employeeId, m, isPaid]);
    open = (await ins(1, false)).rows[0].id;
    paid = (await ins(2, true)).rows[0].id;
    week = (await p().query(
      `INSERT INTO weekly_payroll (employee_id, week_start, week_end, base_amount, net_amount) VALUES ($1,'2031-01-06','2031-01-12',900,900) RETURNING id`, [employeeId])).rows[0].id;
  });

  afterAll(async () => {
    await p().query(`DELETE FROM payroll WHERE employee_id = $1`, [employeeId]).catch(() => undefined);
    await p().query(`DELETE FROM weekly_payroll WHERE employee_id = $1`, [employeeId]).catch(() => undefined);
    await p().query(`DELETE FROM employees WHERE id = $1`, [employeeId]).catch(() => undefined);
    await closeTestPool();
  });

  it('un bulletin provisoire est refusé au paiement, puis payable une fois définitif', async () => {
    expect(await svc.provisionalRefusal('monthly', open)).toBeNull();
    await svc.setProvisional('monthly', [open, paid], true);
    expect(await svc.provisionalRefusal('monthly', open)).toMatch(/provisoire/i);
    // Le bulletin déjà payé n'est pas touché.
    expect(await svc.provisionalRefusal('monthly', paid)).toBeNull();
    // Régénération après la fin de la période : définitif.
    await svc.setProvisional('monthly', [open], false);
    expect(await svc.provisionalRefusal('monthly', open)).toBeNull();
  });

  it('même règle pour l\'hebdomadaire', async () => {
    await svc.setProvisional('weekly', [week], true);
    expect(await svc.provisionalRefusal('weekly', week)).toMatch(/provisoire/i);
    await svc.setProvisional('weekly', [], false); // liste vide : sans effet
    expect(await svc.provisionalRefusal('weekly', week)).toMatch(/provisoire/i);
  });
});
