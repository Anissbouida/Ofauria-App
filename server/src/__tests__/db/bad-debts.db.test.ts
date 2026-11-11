/**
 * Phase 11 (D5-45) — créances douteuses et irrécouvrables.
 *
 *  - classer « irrécouvrable » sort le montant du reste à recouvrer (relances) ;
 *  - classer « douteuse » laisse la facture au recouvrement (signalement) ;
 *  - annuler la classification rétablit le reste ;
 *  - une seule classification active par facture.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, TEST_DATABASE_URL, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Créances douteuses et irrécouvrables', () => {
  const p = () => testPool();
  let badDebtRepository: typeof import('../../repositories/bad-debt.repository.js')['badDebtRepository'];
  let openDocuments: typeof import('../../repositories/receivables.repository.js')['openDocuments'];

  let userId: string, customerId: string, inv1: string, inv2: string;

  const seedInvoice = async (number: string) => {
    const c = await p().connect();
    try {
      await c.query(`SET session_replication_role = 'replica'`);
      const id = (await c.query(
        `INSERT INTO invoices (invoice_number, invoice_date, amount, total_amount, paid_amount, status, invoice_type, source, validation_status, payment_status, kind, customer_id)
         VALUES ($1, CURRENT_DATE - 60, 1000, 1200, 0, 'pending', 'emitted', 'manual', 'validated', 'unpaid', 'invoice', $2) RETURNING id`,
        [number.slice(0, 40), customerId])).rows[0].id;
      return id as string;
    } finally {
      await c.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      c.release();
    }
  };

  const remainingOf = async (invId: string): Promise<number | null> => {
    const docs = await openDocuments({ customerId });
    const row = docs.find(d => d.kind === 'invoice' && d.id === invId);
    return row ? row.remaining : null;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
    ({ badDebtRepository } = await import('../../repositories/bad-debt.repository.js'));
    ({ openDocuments } = await import('../../repositories/receivables.repository.js'));
    userId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,'x','B','D','admin') RETURNING id`, [`bd-${RUN}@test.local`])).rows[0].id;
    customerId = (await p().query(`INSERT INTO customers (first_name, last_name, company_name, customer_type) VALUES ('Pro','BD ${RUN}','Omega ${RUN}','professionnel') RETURNING id`)).rows[0].id;
    inv1 = await seedInvoice(`FAC-BD1-${RUN}`);
    inv2 = await seedInvoice(`FAC-BD2-${RUN}`);
  });

  afterAll(async () => {
    const c = await p().connect();
    try {
      await c.query(`SET session_replication_role = 'replica'`);
      for (const id of [inv1, inv2]) await c.query(`DELETE FROM bad_debts WHERE invoice_id = $1`, [id]).catch(() => undefined);
      for (const id of [inv1, inv2]) await c.query(`DELETE FROM invoices WHERE id = $1`, [id]).catch(() => undefined);
      await c.query(`DELETE FROM customers WHERE id = $1`, [customerId]).catch(() => undefined);
      await c.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
    } finally {
      await c.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      c.release();
    }
    await closeTestPool();
  });

  it('l\'irrécouvrable sort du recouvrement, la douteuse y reste', async () => {
    expect(await remainingOf(inv1)).toBe(1200);
    expect(await remainingOf(inv2)).toBe(1200);

    // Irrécouvrable : la facture disparaît du reste à recouvrer.
    const w = await badDebtRepository.classify({ invoiceId: inv1, status: 'written_off', reason: 'Client en liquidation', createdBy: userId });
    expect('data' in w).toBe(true);
    expect(await remainingOf(inv1)).toBeNull();

    // Douteuse : signalée mais toujours suivie.
    const d = await badDebtRepository.classify({ invoiceId: inv2, status: 'doubtful', reason: 'Retard important', createdBy: userId });
    expect('data' in d).toBe(true);
    expect(await remainingOf(inv2)).toBe(1200);

    // Une seule classification active par facture.
    const dup = await badDebtRepository.classify({ invoiceId: inv1, status: 'doubtful', createdBy: userId });
    expect('error' in dup).toBe(true);

    // Annulation : la créance redevient relançable.
    await badDebtRepository.revert((w as { data: { id: string } }).data.id);
    expect(await remainingOf(inv1)).toBe(1200);
  });
});
