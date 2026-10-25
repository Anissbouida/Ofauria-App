/**
 * F-059 — La declaration CNSS refuse les salaries sans numero CNSS.
 *
 * Avant : declare('cnss') passait meme si des salaries n'avaient pas de numero
 * CNSS ; le fichier e-BDS serait rejete par Damancom. Desormais la declaration
 * est refusee tant qu'un numero manque, en nommant les salaries concernes.
 *
 * Periode 01/2099 (isolee) : 2 salaries, un sans numero CNSS.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, cleanupFixtures, RUN, type Fixtures,
} from './helpers.js';

const YEAR = 2099;
const MONTH = 1;

describe.skipIf(!hasTestDb)('Declaration CNSS — numeros manquants (F-059)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let repo: typeof import('../../repositories/payroll-declarations.repository.js').payrollDeclarationRepository;
  let fx: Fixtures;
  let emp1: string; let emp2: string;

  const clearPeriod = async () => {
    const p = testPool();
    await p.query(`DELETE FROM payroll_declarations WHERE year = $1 AND month = $2`, [YEAR, MONTH]);
    await p.query(`DELETE FROM payroll WHERE year = $1 AND month = $2`, [YEAR, MONTH]);
    await p.query(`DELETE FROM payroll_periods WHERE year = $1 AND month = $2`, [YEAR, MONTH]);
  };

  beforeAll(async () => {
    repos = await importRepositories();
    repo = (await import('../../repositories/payroll-declarations.repository.js')).payrollDeclarationRepository;
    fx = await createBaseFixtures();
    const p = testPool();
    await clearPeriod();

    const e1 = await p.query(
      `INSERT INTO employees (first_name, last_name, role, hire_date, cnss_number, store_id)
       VALUES ('Avec', 'Numero ${RUN}', 'cashier', '2099-01-01', '1234567', $1) RETURNING id`,
      [fx.storeId]
    );
    emp1 = e1.rows[0].id;
    const e2 = await p.query(
      `INSERT INTO employees (first_name, last_name, role, hire_date, cnss_number, store_id)
       VALUES ('Sans', 'Numero ${RUN}', 'cashier', '2099-01-01', NULL, $1) RETURNING id`,
      [fx.storeId]
    );
    emp2 = e2.rows[0].id;

    for (const empId of [emp1, emp2]) {
      await p.query(
        `INSERT INTO payroll (employee_id, month, year, gross_salary, worked_days, is_declared)
         VALUES ($1, $2, $3, 5000, 26, true)`,
        [empId, MONTH, YEAR]
      );
    }
    await p.query(`INSERT INTO payroll_periods (year, month, status) VALUES ($1, $2, 'closed')`, [YEAR, MONTH]);
  }, 60_000);

  afterAll(async () => {
    const p = testPool();
    await clearPeriod();
    await p.query(`DELETE FROM employees WHERE id = ANY($1::uuid[])`, [[emp1, emp2]]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('refuse la declaration CNSS quand un salarie n a pas de numero', async () => {
    await expect(repo.declare('cnss', MONTH, YEAR, null, fx.userId)).rejects.toThrow(/num[ée]ro CNSS|e-BDS|Damancom/i);
  });

  it('accepte la declaration une fois tous les numeros renseignes', async () => {
    await testPool().query(`UPDATE employees SET cnss_number = '7654321' WHERE id = $1`, [emp2]);
    const d = await repo.declare('cnss', MONTH, YEAR, null, fx.userId);
    expect(d).toBeTruthy();
    expect(d.kind).toBe('cnss');
  });
});
