/**
 * Phase 5.6 (mig 484) — mentions légales + numérotation par date, à l'émission.
 *
 *  - ICE obligatoire (quand le contrôle est activé) : une facture à un client
 *    professionnel sans ICE est refusée ; la même devient possible une fois l'ICE renseigné.
 *  - Numérotation selon la date : le numéro émis porte l'année de la facture (FE-YYYY).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';
import { invoiceRepository } from '../../repositories/accounting.repository.js';

const today = new Date().toISOString().slice(0, 10);
const year = today.slice(0, 4);
const presta = (label: string) => ([{ description: label, quantity: 1, unitPrice: 100, subtotal: 100, tvaRate: 20 }]);

describe.skipIf(!hasTestDb)('Mentions légales et numérotation par date', () => {
  const p = () => testPool();
  let storeId: string;
  let userId: string;
  let custNoIce: string;
  let custIce: string;
  let saleNoIce: string;

  beforeAll(async () => {
    // Forçage ICE par processus (ce worker seulement) : n'affecte pas les suites parallèles.
    process.env.ENFORCE_CUSTOMER_ICE = '1';
    storeId = (await p().query(`INSERT INTO stores (name, city) VALUES ($1, 'Test') RETURNING id`, [`Mag Lm ${RUN}`])).rows[0].id;
    userId = (await p().query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, store_id)
       VALUES ($1, 'x', 'Fac', 'Turier', 'admin', $2) RETURNING id`, [`lm-${RUN}@test.local`, storeId])).rows[0].id;
    custNoIce = (await p().query(
      `INSERT INTO customers (first_name, last_name, customer_type, company_name) VALUES ('Pro', 'SansIce ${RUN}', 'professionnel', $1) RETURNING id`,
      [`Pro SansIce ${RUN}`])).rows[0].id;
    custIce = (await p().query(
      `INSERT INTO customers (first_name, last_name, customer_type, company_name, ice) VALUES ('Pro', 'AvecIce ${RUN}', 'professionnel', $1, $2) RETURNING id`,
      [`Pro AvecIce ${RUN}`, `0012345${String(RUN).slice(-6).padStart(6, '0')}`.slice(0, 15)])).rows[0].id;
    saleNoIce = (await p().query(
      `INSERT INTO sales (sale_number, user_id, customer_id, subtotal, tax_amount, total, payment_method, payment_status, sale_type, store_id)
       VALUES ($1, $2, $3, 24, 4, 24, 'cash', 'paid', 'standard', $4) RETURNING id`,
      [`T-LM-${RUN}`.slice(0, 20), userId, custNoIce, storeId])).rows[0].id;
    const prod = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1, $2, 12) RETURNING id`, [`Prod Lm ${RUN}`, `prod-lm-${RUN}`])).rows[0].id;
    await p().query(`INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal, tax_rate, tax_amount) VALUES ($1, $2, 2, 12, 24, 20, 4)`, [saleNoIce, prod]);
  });

  afterAll(async () => {
    delete process.env.ENFORCE_CUSTOMER_ICE;
    const cc = await p().connect();
    try {
      await cc.query(`SET session_replication_role = 'replica'`);
      await cc.query(`DELETE FROM journal_entry_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE store_id = $1)`, [storeId]).catch(() => undefined);
      await cc.query(`DELETE FROM journal_entries WHERE store_id = $1`, [storeId]).catch(() => undefined);
      await cc.query(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE store_id = $1)`, [storeId]).catch(() => undefined);
      await cc.query(`DELETE FROM invoices WHERE store_id = $1`, [storeId]).catch(() => undefined);
      await cc.query(`DELETE FROM sale_items WHERE sale_id = $1`, [saleNoIce]).catch(() => undefined);
      await cc.query(`DELETE FROM sales WHERE store_id = $1`, [storeId]).catch(() => undefined);
      await cc.query(`DELETE FROM products WHERE slug = $1`, [`prod-lm-${RUN}`]).catch(() => undefined);
      await cc.query(`DELETE FROM customers WHERE id IN ($1, $2)`, [custNoIce, custIce]).catch(() => undefined);
      await cc.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
      await cc.query(`DELETE FROM stores WHERE id = $1`, [storeId]).catch(() => undefined);
    } finally {
      await cc.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      cc.release();
    }
    await closeTestPool();
  });

  it('refuse une facture à un professionnel sans ICE (contrôle activé)', async () => {
    await expect(invoiceRepository.create({
      invoiceType: 'emitted', customerId: custNoIce, invoiceDate: today, amount: 100, createdBy: userId, storeId,
      items: presta('Prestation'),
    })).rejects.toThrow(/ICE/);
  });

  it('accepte une fois l\'ICE renseigné, numéro à l\'année de la facture', async () => {
    const inv = await invoiceRepository.create({
      invoiceType: 'emitted', customerId: custIce, invoiceDate: today, amount: 100, createdBy: userId, storeId,
      items: presta('Prestation'),
    });
    expect(inv.invoice_type).toBe('emitted');
    expect(String(inv.invoice_number)).toMatch(new RegExp(`^FE-${year}-`));
  });

  it('refuse aussi une facture depuis un ticket si le client pro n\'a pas d\'ICE', async () => {
    await expect(invoiceRepository.createFromSale(saleNoIce, undefined, userId)).rejects.toThrow(/ICE/);
  });
});
