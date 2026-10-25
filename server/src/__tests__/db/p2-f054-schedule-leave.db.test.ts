/**
 * F-054 — Le planning n'est plus rejete en bloc pour un conge.
 *
 * Avant : POST /schedules/week renvoyait 409 si UNE assignation chevauchait un
 * conge approuve ; le gerant devait retirer a la main les jours de conge de tous
 * les salaries. Desormais bulkUpsertWeek pre-exclut les jours en conge (non
 * planifies) et applique le reste, en renvoyant les jours ignores (conflicts).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, cleanupFixtures, RUN, type Fixtures,
} from './helpers.js';

const D = '2099-03-02';           // jour planifie
const SHIFT = `TST-${RUN}`;

describe.skipIf(!hasTestDb)('Planning hebdo vs conge approuve (F-054)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let scheduleRepository: typeof import('../../repositories/employee.repository.js').scheduleRepository;
  let fx: Fixtures;
  let emp1: string; let emp2: string;

  beforeAll(async () => {
    repos = await importRepositories();
    scheduleRepository = (await import('../../repositories/employee.repository.js')).scheduleRepository;
    fx = await createBaseFixtures();
    const p = testPool();
    const e1 = await p.query(
      `INSERT INTO employees (first_name, last_name, role, hire_date, store_id)
       VALUES ('Enconge', 'F054 ${RUN}', 'cashier', '2099-01-01', $1) RETURNING id`, [fx.storeId]
    );
    emp1 = e1.rows[0].id;
    const e2 = await p.query(
      `INSERT INTO employees (first_name, last_name, role, hire_date, store_id)
       VALUES ('Normal', 'F054 ${RUN}', 'cashier', '2099-01-01', $1) RETURNING id`, [fx.storeId]
    );
    emp2 = e2.rows[0].id;
    await p.query(`INSERT INTO shifts (code, label, start_time, end_time) VALUES ($1, 'Test', '07:00', '14:00')`, [SHIFT]);
    // Conge approuve de emp1 le jour D.
    await p.query(
      `INSERT INTO leaves (employee_id, start_date, end_date, days, status) VALUES ($1, $2, $2, 1, 'approved')`,
      [emp1, D]
    );
  }, 60_000);

  afterAll(async () => {
    const p = testPool();
    await p.query(`DELETE FROM schedules WHERE employee_id = ANY($1::uuid[])`, [[emp1, emp2]]).catch(() => undefined);
    await p.query(`DELETE FROM attendance WHERE employee_id = ANY($1::uuid[])`, [[emp1, emp2]]).catch(() => undefined);
    await p.query(`DELETE FROM leaves WHERE employee_id = ANY($1::uuid[])`, [[emp1, emp2]]).catch(() => undefined);
    await p.query(`DELETE FROM shifts WHERE code = $1`, [SHIFT]).catch(() => undefined);
    await p.query(`DELETE FROM employees WHERE id = ANY($1::uuid[])`, [[emp1, emp2]]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('applique emp2, ignore le jour en conge de emp1, sans tout rejeter', async () => {
    const res = await scheduleRepository.bulkUpsertWeek([
      { employeeId: emp1, date: D, shiftCode: SHIFT },
      { employeeId: emp2, date: D, shiftCode: SHIFT },
    ]);

    expect(res.conflicts).toContain(`${emp1}@${D}`);
    expect(res.conflicts).not.toContain(`${emp2}@${D}`);
    expect(res.updated).toBe(1);   // seul emp2 planifie

    const p = testPool();
    const s1 = await p.query(`SELECT 1 FROM schedules WHERE employee_id = $1 AND date = $2`, [emp1, D]);
    const s2 = await p.query(`SELECT 1 FROM schedules WHERE employee_id = $1 AND date = $2`, [emp2, D]);
    expect(s1.rows).toHaveLength(0);   // emp1 en conge : non planifie
    expect(s2.rows).toHaveLength(1);   // emp2 planifie
  });
});
