/**
 * G0-14 (plan d'action 2026-11) — paiement d'une paie dans UNE transaction.
 *
 *  - withTransaction : tout ou rien, y compris pour le code appelé qui ouvre sa
 *    propre transaction (BEGIN interne → point de sauvegarde) ;
 *  - échec provoqué au milieu du paiement : rien n'est écrit ;
 *  - double clic : un seul paiement.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { hasTestDb, testPool, closeTestPool, TEST_DATABASE_URL, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Paiement de paie en transaction (G0-14)', () => {
  const p = () => testPool();
  let database: typeof import('../../config/database.js');
  let weekly: typeof import('../../repositories/weekly-payroll.repository.js')['weeklyPayrollRepository'];
  let payments: typeof import('../../repositories/accounting.repository.js')['paymentRepository'];
  let employeeId: string, userId: string, slipA: string, slipB: string;

  const paymentsOf = async () => (await p().query(`SELECT count(*)::int AS n FROM payments WHERE employee_id = $1`, [employeeId])).rows[0].n as number;
  const paidOf = async (id: string) => (await p().query(`SELECT paid FROM weekly_payroll WHERE id = $1`, [id])).rows[0].paid as boolean;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
    database = await import('../../config/database.js');
    ({ weeklyPayrollRepository: weekly } = await import('../../repositories/weekly-payroll.repository.js'));
    ({ paymentRepository: payments } = await import('../../repositories/accounting.repository.js'));
    userId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,'x','G','Paie','admin') RETURNING id`, [`g014-${RUN}@test.local`])).rows[0].id;
    employeeId = (await p().query(`INSERT INTO employees (first_name, last_name, role, hire_date, weekly_salary, pay_frequency, is_declared) VALUES ('Hebdo',$1,'baker','2025-01-01',900,'weekly',false) RETURNING id`, [`G014 ${RUN}`])).rows[0].id;
    const slip = (start: string, end: string) => p().query(
      `INSERT INTO weekly_payroll (employee_id, week_start, week_end, base_amount, net_amount) VALUES ($1,$2,$3,900,900) RETURNING id`, [employeeId, start, end]);
    slipA = (await slip('2026-03-02', '2026-03-08')).rows[0].id;
    slipB = (await slip('2026-03-09', '2026-03-15')).rows[0].id;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    const c = await p().connect();
    try {
      await c.query(`SET session_replication_role = 'replica'`);
      await c.query(`DELETE FROM payments WHERE employee_id = $1`, [employeeId]).catch(() => undefined);
      await c.query(`DELETE FROM weekly_payroll WHERE employee_id = $1`, [employeeId]).catch(() => undefined);
      await c.query(`DELETE FROM employees WHERE id = $1`, [employeeId]).catch(() => undefined);
      await c.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
    } finally {
      await c.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      c.release();
    }
    await database.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('withTransaction : tout ou rien, BEGIN interne devenu point de sauvegarde', async () => {
    const note = `tx-${RUN}`;
    const count = async () => (await p().query(`SELECT count(*)::int AS n FROM weekly_payroll WHERE notes = $1`, [note])).rows[0].n;
    // Échec après une écriture et une « transaction » interne validée : rien ne reste.
    await expect(database.withTransaction(async () => {
      await database.db.query(`UPDATE weekly_payroll SET notes = $2 WHERE id = $1`, [slipA, note]);
      const c = await database.db.getClient();
      await c.query('BEGIN');
      await c.query(`UPDATE weekly_payroll SET notes = $2 WHERE id = $1`, [slipB, note]);
      await c.query('COMMIT');
      c.release();
      expect(database.inTransaction()).toBe(true);
      throw new Error('panne');
    })).rejects.toThrow('panne');
    expect(await count()).toBe(0);
    // Réussite, avec un ROLLBACK interne qui n'annule que sa part.
    await database.withTransaction(async () => {
      await database.db.query(`UPDATE weekly_payroll SET notes = $2 WHERE id = $1`, [slipA, note]);
      const c = await database.db.getClient();
      await c.query('BEGIN');
      await c.query(`UPDATE weekly_payroll SET notes = $2 WHERE id = $1`, [slipB, note]);
      await c.query('ROLLBACK');
      c.release();
    });
    expect(await count()).toBe(1);
    expect(database.inTransaction()).toBe(false);
    await p().query(`UPDATE weekly_payroll SET notes = NULL WHERE employee_id = $1`, [employeeId]);
  });

  it('échec au milieu du paiement : ni paiement, ni marquage payé', async () => {
    const real = payments.create.bind(payments);
    const spy = vi.spyOn(payments, 'create').mockImplementationOnce(async (...args: Parameters<typeof real>) => {
      await real(...args);          // la sortie de caisse est bien écrite…
      throw new Error('panne après la sortie de caisse');
    });
    await expect(weekly.markPaid(slipA, 'cash', userId)).rejects.toThrow(/Paiement annulé/);
    spy.mockRestore();
    expect(await paidOf(slipA)).toBe(false);   // …puis tout est annulé par la transaction
    expect(await paymentsOf()).toBe(0);
  }, 60_000);

  it('paiement normal, puis double clic : un seul paiement', async () => {
    const [a, b] = await Promise.all([weekly.markPaid(slipA, 'cash', userId), weekly.markPaid(slipA, 'cash', userId)]);
    expect(a?.paid).toBe(true);
    expect(b?.paid).toBe(true);
    expect(await paidOf(slipA)).toBe(true);
    expect(await paymentsOf()).toBe(1);
    // Rejouer plus tard ne recrée rien.
    await weekly.markPaid(slipA, 'cash', userId);
    expect(await paymentsOf()).toBe(1);
  }, 60_000);
});
