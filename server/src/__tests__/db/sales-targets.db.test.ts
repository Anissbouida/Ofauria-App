/**
 * Phase 11 (D3-13) — objectifs par commercial.
 *
 *  - le réalisé se lit sur les factures émises du vendeur, net des avoirs ;
 *  - le rapport croise objectif et réalisé, calcule écart et pourcentage ;
 *  - l'objectif est unique par vendeur/période (upsert).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, TEST_DATABASE_URL, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Objectifs par commercial', () => {
  const p = () => testPool();
  let salesTargetRepository: typeof import('../../repositories/sales-target.repository.js')['salesTargetRepository'];

  let sellerId: string, customerId: string;
  const invIds: string[] = [];
  const START = '2026-01-01', END = '2026-01-31';

  const seedInvoice = async (kind: 'invoice' | 'credit_note', total: number, date: string): Promise<string> => {
    const c = await p().connect();
    try {
      await c.query(`SET session_replication_role = 'replica'`);
      // Un avoir émis exige une facture d'origine + un motif (contrainte mig 450).
      const creditedId = kind === 'credit_note' ? (invIds[0] ?? null) : null;
      const creditReason = kind === 'credit_note' ? 'commercial' : null;
      const id = (await c.query(
        `INSERT INTO invoices (invoice_number, invoice_date, amount, total_amount, status, invoice_type, source, validation_status, payment_status, kind, customer_id, salesperson_id, credited_invoice_id, credit_reason)
         VALUES ($1,$2,$3,$4,'pending','emitted','manual','validated','unpaid',$5,$6,$7,$8,$9) RETURNING id`,
        [`FAC-T-${RUN}-${invIds.length}`.slice(0, 40), date, total, total, kind, customerId, sellerId, creditedId, creditReason])).rows[0].id;
      invIds.push(id);
      return id;
    } finally {
      await c.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      c.release();
    }
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
    ({ salesTargetRepository } = await import('../../repositories/sales-target.repository.js'));

    sellerId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,'x','Vendeur','T${RUN}','admin') RETURNING id`, [`seller-${RUN}@test.local`])).rows[0].id;
    customerId = (await p().query(`INSERT INTO customers (first_name, last_name, customer_type) VALUES ('Cli','T ${RUN}','professionnel') RETURNING id`)).rows[0].id;
    await seedInvoice('invoice', 8000, '2026-01-10');
    await seedInvoice('credit_note', 1000, '2026-01-15');
    await seedInvoice('invoice', 2000, '2026-02-10'); // hors période
  });

  afterAll(async () => {
    const c = await p().connect();
    try {
      await c.query(`SET session_replication_role = 'replica'`);
      await c.query(`DELETE FROM sales_targets WHERE salesperson_id = $1`, [sellerId]).catch(() => undefined);
      for (const id of invIds) await c.query(`DELETE FROM invoices WHERE id = $1`, [id]).catch(() => undefined);
      await c.query(`DELETE FROM customers WHERE id = $1`, [customerId]).catch(() => undefined);
      await c.query(`DELETE FROM users WHERE id = $1`, [sellerId]).catch(() => undefined);
    } finally {
      await c.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      c.release();
    }
    await closeTestPool();
  });

  it('croise objectif et réalisé net des avoirs', async () => {
    await salesTargetRepository.upsert({ salespersonId: sellerId, periodStart: START, periodEnd: END, targetAmount: 10000 });
    const rep = await salesTargetRepository.report(START, END);
    const row = rep.find(r => r.salespersonId === sellerId);
    expect(row).toBeTruthy();
    expect(row!.target).toBe(10000);
    expect(row!.realized).toBe(7000); // 8000 − 1000 (avoir), la facture de février exclue
    expect(row!.gap).toBe(-3000);
    expect(row!.pct).toBe(70);
  });

  it('objectif unique par vendeur/période (upsert)', async () => {
    await salesTargetRepository.upsert({ salespersonId: sellerId, periodStart: START, periodEnd: END, targetAmount: 12000 });
    const rep = await salesTargetRepository.report(START, END);
    const row = rep.find(r => r.salespersonId === sellerId);
    expect(row!.target).toBe(12000);
    const n = (await p().query(`SELECT count(*)::int AS n FROM sales_targets WHERE salesperson_id = $1 AND period_start = $2 AND period_end = $3`, [sellerId, START, END])).rows[0].n;
    expect(n).toBe(1);
  });
});
