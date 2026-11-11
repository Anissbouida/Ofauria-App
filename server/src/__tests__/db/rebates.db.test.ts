/**
 * Phase 11 (D5-12) — ristournes de fin d'année (RFA).
 *
 *  - la ristourne = taux × CA annuel (net des avoirs) au-delà du seuil ;
 *  - sous le seuil, pas de ristourne ;
 *  - la clôture fige le CA et la ristourne ;
 *  - un seul accord par client et par année.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, TEST_DATABASE_URL, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Ristournes de fin d\'année', () => {
  const p = () => testPool();
  let rebateRepository: typeof import('../../repositories/rebate.repository.js')['rebateRepository'];

  let userId: string, custA: string, custB: string;
  const invIds: string[] = [];
  const agrIds: string[] = [];

  const seedInvoice = async (customerId: string, kind: 'invoice' | 'credit_note', total: number, date: string) => {
    const c = await p().connect();
    try {
      await c.query(`SET session_replication_role = 'replica'`);
      const creditedId = kind === 'credit_note' ? (invIds[0] ?? null) : null;
      const creditReason = kind === 'credit_note' ? 'commercial' : null;
      const id = (await c.query(
        `INSERT INTO invoices (invoice_number, invoice_date, amount, total_amount, status, invoice_type, source, validation_status, payment_status, kind, customer_id, credited_invoice_id, credit_reason)
         VALUES ($1,$2,$3,$4,'pending','emitted','manual','validated','unpaid',$5,$6,$7,$8) RETURNING id`,
        [`FAC-R-${RUN}-${invIds.length}`.slice(0, 40), date, total, total, kind, customerId, creditedId, creditReason])).rows[0].id;
      invIds.push(id);
    } finally {
      await c.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      c.release();
    }
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
    ({ rebateRepository } = await import('../../repositories/rebate.repository.js'));

    userId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,'x','R','T','admin') RETURNING id`, [`reb-${RUN}@test.local`])).rows[0].id;
    custA = (await p().query(`INSERT INTO customers (first_name, last_name, company_name, customer_type) VALUES ('Pro','A ${RUN}','Atlas ${RUN}','professionnel') RETURNING id`)).rows[0].id;
    custB = (await p().query(`INSERT INTO customers (first_name, last_name, company_name, customer_type) VALUES ('Pro','B ${RUN}','Bravo ${RUN}','professionnel') RETURNING id`)).rows[0].id;
    await seedInvoice(custA, 'invoice', 10000, '2026-03-10');
    await seedInvoice(custA, 'invoice', 5000, '2026-06-10');
    await seedInvoice(custA, 'credit_note', 1000, '2026-07-10'); // net 14000
    await seedInvoice(custB, 'invoice', 5000, '2026-03-10');
  });

  afterAll(async () => {
    const c = await p().connect();
    try {
      await c.query(`SET session_replication_role = 'replica'`);
      for (const id of agrIds) await c.query(`DELETE FROM rebate_agreements WHERE id = $1`, [id]).catch(() => undefined);
      for (const id of invIds) await c.query(`DELETE FROM invoices WHERE id = $1`, [id]).catch(() => undefined);
      for (const id of [custA, custB]) await c.query(`DELETE FROM customers WHERE id = $1`, [id]).catch(() => undefined);
      await c.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
    } finally {
      await c.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      c.release();
    }
    await closeTestPool();
  });

  it('ristourne = taux × CA net au-delà du seuil', async () => {
    const cr = await rebateRepository.create({ customerId: custA, year: 2026, ratePercent: 2, minTurnover: 10000, createdBy: userId });
    expect('data' in cr).toBe(true);
    const id = (cr as { data: { id: string } }).data.id;
    agrIds.push(id);

    const comp = await rebateRepository.compute(id);
    expect(comp!.turnover).toBe(14000);
    expect(comp!.eligible).toBe(true);
    expect(comp!.amount).toBe(280); // 14000 × 2 %

    // Un seul accord par client/année.
    const dup = await rebateRepository.create({ customerId: custA, year: 2026, ratePercent: 3, createdBy: userId });
    expect('error' in dup).toBe(true);

    // Clôture : fige CA et ristourne.
    const s = await rebateRepository.settle(id);
    expect('data' in s).toBe(true);
    const row = (s as { data: Record<string, unknown> }).data;
    expect(row.status).toBe('settled');
    expect(Number(row.computed_amount)).toBe(280);
    expect(Number(row.computed_turnover)).toBe(14000);
  });

  it('sous le seuil, pas de ristourne', async () => {
    const cr = await rebateRepository.create({ customerId: custB, year: 2026, ratePercent: 2, minTurnover: 10000, createdBy: userId });
    const id = (cr as { data: { id: string } }).data.id;
    agrIds.push(id);
    const comp = await rebateRepository.compute(id);
    expect(comp!.turnover).toBe(5000);
    expect(comp!.eligible).toBe(false);
    expect(comp!.amount).toBe(0);
  });
});
