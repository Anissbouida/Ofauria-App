/**
 * F-060 — tolerance d'arrondi des acomptes au paiement du bulletin mensuel.
 *
 * Un salarie hebdo declare voit son net mensuel en partie verse par les acomptes
 * hebdomadaires (mig 327). Chaque acompte est arrondi au centime ; sur 4-5
 * semaines, leur somme peut depasser le net mensuel recalcule de quelques
 * centimes sans vrai trop-percu. Avant le correctif, un ecart de 0,01 DH bloquait
 * le paiement (« Acomptes verses superieurs au net du mois »). On tolere ce bruit
 * d'arrondi (< 0,05 DH) ; un vrai trop-percu (en dirhams) doit toujours bloquer.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, num, RUN, type Fixtures } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
describe.skipIf(!hasTestDb)('F-060 — paie : tolerance d arrondi des acomptes', () => {
  let payrollRepository: any;
  let fx: Fixtures;
  const employeeIds: string[] = [];

  beforeAll(async () => {
    await importRepositories();
    payrollRepository = (await import('../../repositories/employee.repository.js')).payrollRepository;
    fx = await createBaseFixtures();
  }, 60_000);

  afterAll(async () => {
    const p = testPool();
    const run = async (sql: string, params: unknown[]) => { try { await p.query(sql, params); } catch { /* best effort */ } };
    for (const id of employeeIds) {
      await run(`DELETE FROM payments WHERE employee_id = $1`, [id]);
      await run(`DELETE FROM payroll WHERE employee_id = $1`, [id]);
      await run(`DELETE FROM weekly_payroll WHERE employee_id = $1`, [id]);
      await run(`DELETE FROM employees WHERE id = $1`, [id]);
    }
    await run(`DELETE FROM users WHERE id = $1`, [fx.userId]);
    await run(`DELETE FROM stores WHERE id = $1`, [fx.storeId]);
    await closeTestPool();
  }, 60_000);

  /** Salarie hebdo declare + 1 semaine payee (jeudi en juillet) de net = weeklyNet,
   *  + bulletin mensuel de juillet dont net_salary = weeklyNet - overByDh. */
  async function setup(weeklyNet: number, overByDh: number): Promise<string> {
    const p = testPool();
    const emp = await p.query(
      `INSERT INTO employees (first_name, last_name, role, hire_date, pay_frequency, weekly_salary, is_active, store_id)
       VALUES ('Hebdo', $1, 'cashier', '2026-01-01', 'weekly', $2, true, $3) RETURNING id`,
      [`F060-${RUN}-${employeeIds.length}`, weeklyNet, fx.storeId]
    );
    const empId = emp.rows[0].id as string;
    employeeIds.push(empId);
    // Semaine dont le jeudi (week_start + 3 = 2026-07-09) tombe en juillet, payee,
    // avec retenue provisoire > 0 (bulletin « declare »).
    await p.query(
      `INSERT INTO weekly_payroll (employee_id, week_start, week_end, base_amount, net_amount, withholding_amount, paid, paid_at)
       VALUES ($1, '2026-07-06', '2026-07-12', $2, $2, 10, true, NOW())`,
      [empId, weeklyNet]
    );
    const pr = await p.query(
      `INSERT INTO payroll (employee_id, month, year, pay_frequency, net_salary, acomptes_amount, paid)
       VALUES ($1, 7, 2026, 'weekly', $2, $3, false) RETURNING id`,
      [empId, Math.round((weeklyNet - overByDh) * 100) / 100, weeklyNet]
    );
    return pr.rows[0].id as string;
  }

  it('tolere un depassement d arrondi de 0,01 DH : le bulletin se paie sans erreur', async () => {
    const payrollId = await setup(500, 0.01); // net_salary 499,99 ; acomptes 500 -> net -0,01
    const r = await payrollRepository.markPaid(payrollId, 'cash', fx.userId, fx.storeId);
    expect(r).toBeTruthy();
    expect(r.paid).toBe(true);
    // net negatif d'un centime -> aucun decaissement (cashOut <= 0).
    const pay = await testPool().query(
      `SELECT COUNT(*)::int AS n FROM payments WHERE employee_id = $1 AND type = 'salary'`, [employeeIds[employeeIds.length - 1]]
    );
    expect(num(pay.rows[0].n)).toBe(0);
  });

  it('bloque toujours un vrai trop-percu (60 DH)', async () => {
    const payrollId = await setup(500, 60); // net_salary 440 ; acomptes 500 -> net -60
    await expect(payrollRepository.markPaid(payrollId, 'cash', fx.userId, fx.storeId))
      .rejects.toThrow(/trop-perçu/i);
  });
});
