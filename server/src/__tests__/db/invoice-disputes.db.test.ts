/**
 * Phase 11 (D5-59) — litige rattaché à une facture.
 *
 *  - ouvrir un litige exclut le montant contesté du reste à recouvrer (donc des
 *    relances, qui partent de openDocuments) et passe la facture en 'disputed' ;
 *  - un litige couvrant tout le solde fait sortir la pièce des relances ;
 *  - résoudre rétablit le reste et ramène la facture en 'pending' ;
 *  - un seul litige ouvert par facture.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, TEST_DATABASE_URL, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Litiges sur facture', () => {
  const p = () => testPool();
  let invoiceDisputeRepository: typeof import('../../repositories/invoice-dispute.repository.js')['invoiceDisputeRepository'];
  let openDocuments: typeof import('../../repositories/receivables.repository.js')['openDocuments'];

  let userId: string, customerId: string, invId: string;

  const remainingOf = async (cid: string): Promise<number | null> => {
    const docs = await openDocuments({ customerId: cid });
    const row = docs.find(d => d.kind === 'invoice' && d.id === invId);
    return row ? row.remaining : null;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
    ({ invoiceDisputeRepository } = await import('../../repositories/invoice-dispute.repository.js'));
    ({ openDocuments } = await import('../../repositories/receivables.repository.js'));

    userId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,'x','L','T','admin') RETURNING id`, [`disp-${RUN}@test.local`])).rows[0].id;
    customerId = (await p().query(`INSERT INTO customers (first_name, last_name, company_name, customer_type) VALUES ('Pro','D ${RUN}','Delta ${RUN}','professionnel') RETURNING id`)).rows[0].id;
    const c = await p().connect();
    try {
      await c.query(`SET session_replication_role = 'replica'`);
      invId = (await c.query(
        `INSERT INTO invoices (invoice_number, invoice_date, amount, total_amount, paid_amount, status, invoice_type, source, validation_status, payment_status, kind, customer_id)
         VALUES ($1, CURRENT_DATE - 40, 1000, 1200, 0, 'pending', 'emitted', 'manual', 'validated', 'unpaid', 'invoice', $2) RETURNING id`,
        [`FAC-D-${RUN}`.slice(0, 40), customerId])).rows[0].id;
    } finally {
      await c.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      c.release();
    }
  });

  afterAll(async () => {
    const c = await p().connect();
    try {
      await c.query(`SET session_replication_role = 'replica'`);
      await c.query(`DELETE FROM invoice_disputes WHERE invoice_id = $1`, [invId]).catch(() => undefined);
      await c.query(`DELETE FROM invoices WHERE id = $1`, [invId]).catch(() => undefined);
      await c.query(`DELETE FROM customers WHERE id = $1`, [customerId]).catch(() => undefined);
      await c.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
    } finally {
      await c.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      c.release();
    }
    await closeTestPool();
  });

  it('exclut le montant contesté du reste à recouvrer', async () => {
    expect(await remainingOf(customerId)).toBe(1200);

    const d = await invoiceDisputeRepository.open({ invoiceId: invId, reason: 'Quantité livrée contestée', disputedAmount: 500, createdBy: userId });
    expect('data' in d).toBe(true);
    const disputeId = (d as { data: { id: string } }).data.id;

    // Reste à recouvrer réduit du montant contesté, facture en litige.
    expect(await remainingOf(customerId)).toBe(700);
    const st = (await p().query(`SELECT status FROM invoices WHERE id = $1`, [invId])).rows[0].status;
    expect(st).toBe('disputed');

    // Un seul litige ouvert par facture.
    const dup = await invoiceDisputeRepository.open({ invoiceId: invId, reason: 'Autre', disputedAmount: 100, createdBy: userId });
    expect('error' in dup).toBe(true);

    // Résolution : reste rétabli, facture de nouveau relançable.
    const r = await invoiceDisputeRepository.resolve(disputeId, 'Accord commercial, avoir émis');
    expect('data' in r).toBe(true);
    expect(await remainingOf(customerId)).toBe(1200);
    const st2 = (await p().query(`SELECT status FROM invoices WHERE id = $1`, [invId])).rows[0].status;
    expect(st2).toBe('pending');
  });

  it('un litige couvrant tout le solde fait sortir la pièce des relances', async () => {
    const d = await invoiceDisputeRepository.open({ invoiceId: invId, reason: 'Facture entièrement contestée', disputedAmount: 5000, createdBy: userId });
    expect('data' in d).toBe(true); // montant plafonné au reste (1200)
    // La pièce disparaît de la file de recouvrement.
    expect(await remainingOf(customerId)).toBeNull();
    await invoiceDisputeRepository.reject((d as { data: { id: string } }).data.id, 'Litige non fondé');
    expect(await remainingOf(customerId)).toBe(1200);
  });
});
