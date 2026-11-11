/**
 * Phase 10.3 — portail client : « un client pro télécharge sa facture ».
 *
 *  - jeton : émission, vérification, révocation (un seul actif par client) ;
 *  - cloisonnement : la requête de factures du portail ne voit QUE le client ;
 *  - téléchargement : invoicePdfById (source unique partagée avec l'interne)
 *    produit un PDF valide pour la facture du client.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, TEST_DATABASE_URL, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Portail client', () => {
  const p = () => testPool();
  let customerPortalRepository: typeof import('../../repositories/customer-portal.repository.js')['customerPortalRepository'];
  let invoicePdfById: typeof import('../../services/invoice-pdf-builder.service.js')['invoicePdfById'];

  let userId: string, custA: string, custB: string, invA: string, invB: string;

  const seedInvoice = async (customerId: string, number: string) => {
    const c = await p().connect();
    try {
      await c.query(`SET session_replication_role = 'replica'`); // évite les triggers (ledger)
      const r = await c.query(
        `INSERT INTO invoices (invoice_number, invoice_date, amount, total_amount, status, invoice_type, source, validation_status, payment_status, kind, customer_id)
         VALUES ($1, CURRENT_DATE, 100, 120, 'pending', 'emitted', 'manual', 'validated', 'unpaid', 'invoice', $2) RETURNING id`,
        [number, customerId]);
      return r.rows[0].id as string;
    } finally {
      await c.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      c.release();
    }
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
    ({ customerPortalRepository } = await import('../../repositories/customer-portal.repository.js'));
    ({ invoicePdfById } = await import('../../services/invoice-pdf-builder.service.js'));

    userId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,'x','P','T','admin') RETURNING id`, [`portal-${RUN}@test.local`])).rows[0].id;
    custA = (await p().query(`INSERT INTO customers (first_name, last_name, company_name, customer_type) VALUES ('Pro','A ${RUN}','Atlas ${RUN}','professionnel') RETURNING id`)).rows[0].id;
    custB = (await p().query(`INSERT INTO customers (first_name, last_name, company_name, customer_type) VALUES ('Pro','B ${RUN}','Beta ${RUN}','professionnel') RETURNING id`)).rows[0].id;
    invA = await seedInvoice(custA, `FAC-A-${RUN}`.slice(0, 40));
    invB = await seedInvoice(custB, `FAC-B-${RUN}`.slice(0, 40));
  });

  afterAll(async () => {
    const c = await p().connect();
    try {
      await c.query(`SET session_replication_role = 'replica'`);
      for (const id of [custA, custB]) await c.query(`DELETE FROM customer_portal_tokens WHERE customer_id = $1`, [id]).catch(() => undefined);
      for (const id of [invA, invB]) await c.query(`DELETE FROM invoices WHERE id = $1`, [id]).catch(() => undefined);
      for (const id of [custA, custB]) await c.query(`DELETE FROM customers WHERE id = $1`, [id]).catch(() => undefined);
      await c.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
    } finally {
      await c.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      c.release();
    }
    await closeTestPool();
  });

  it('émet, vérifie et révoque un jeton (un seul actif)', async () => {
    const t1 = await customerPortalRepository.issue(custA, userId);
    expect(t1.token).toMatch(/^kptl_[0-9a-f]+$/);
    expect((await customerPortalRepository.verify(t1.token))?.customerId).toBe(custA);

    // Une nouvelle émission révoque la précédente.
    const t2 = await customerPortalRepository.issue(custA, userId);
    expect(await customerPortalRepository.verify(t1.token)).toBeNull();
    expect((await customerPortalRepository.verify(t2.token))?.customerId).toBe(custA);

    // Mauvais jeton, puis révocation.
    expect(await customerPortalRepository.verify('kptl_deadbeefdeadbeefdeadbeef')).toBeNull();
    await customerPortalRepository.revoke(custA);
    expect(await customerPortalRepository.verify(t2.token)).toBeNull();
    expect(await customerPortalRepository.statusFor(custA)).toBeNull();
  });

  it('cloisonne les factures au client', async () => {
    const rows = (await p().query(
      `SELECT id, invoice_number FROM invoices
        WHERE customer_id = $1 AND kind IN ('invoice','credit_note')`, [custA])).rows;
    expect(rows.map((r: { id: string }) => r.id)).toContain(invA);
    expect(rows.map((r: { id: string }) => r.id)).not.toContain(invB);
  });

  it('télécharge la facture du client (PDF valide)', async () => {
    const built = await invoicePdfById(invA);
    expect(built).not.toBeNull();
    expect(built!.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(built!.filename).toContain('FAC-A');
    // Une facture inexistante renvoie null (le contrôleur répond 404).
    expect(await invoicePdfById('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});
