/**
 * Phase 5.5 (mig 483) — facture depuis un ticket de caisse.
 *
 * Un client demande sa facture après un achat au comptoir. La vente POS est déjà
 * comptabilisée ; la facture est une pièce légale qui ne recompte pas. On vérifie :
 *   - createFromSale émet une facture émise (série continue) liée au ticket, payée,
 *     dont les lignes reprennent HT/TVA par article ;
 *   - fromInvoice renvoie null pour cette facture (source_sale_id) : aucune écriture ;
 *   - un même ticket ne se facture pas deux fois ;
 *   - un ticket anonyme exige un client.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';
import { invoiceRepository } from '../../repositories/accounting.repository.js';
import { fromInvoice, type InvoiceRow } from '../../services/journal-generator.service.js';

describe.skipIf(!hasTestDb)('Facture depuis un ticket de caisse', () => {
  const p = () => testPool();
  let storeId: string;
  let userId: string;
  let customerId: string;
  let productId: string;
  let saleId: string;
  let anonSaleId: string;

  beforeAll(async () => {
    storeId = (await p().query(`INSERT INTO stores (name, city) VALUES ($1, 'Test') RETURNING id`, [`Mag Fs ${RUN}`])).rows[0].id;
    userId = (await p().query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, store_id)
       VALUES ($1, 'x', 'Cai', 'Ssier', 'admin', $2) RETURNING id`, [`fs-${RUN}@test.local`, storeId])).rows[0].id;
    customerId = (await p().query(
      `INSERT INTO customers (first_name, last_name, customer_type) VALUES ('Cli', 'Fs ${RUN}', 'particulier') RETURNING id`)).rows[0].id;
    productId = (await p().query(
      `INSERT INTO products (name, slug, price) VALUES ($1, $2, 12) RETURNING id`,
      [`Prod Fs ${RUN}`, `prod-fs-${RUN}`])).rows[0].id;

    // Ticket standard payé, avec client : 2 × 12 = 24 TTC, TVA 20 % incluse (HT 20, TVA 4).
    saleId = (await p().query(
      `INSERT INTO sales (sale_number, user_id, customer_id, subtotal, tax_amount, total, payment_method, payment_status, sale_type, store_id)
       VALUES ($1, $2, $3, 24, 4, 24, 'cash', 'paid', 'standard', $4) RETURNING id`,
      [`T-FS-${RUN}`.slice(0, 20), userId, customerId, storeId])).rows[0].id;
    await p().query(
      `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal, tax_rate, tax_amount)
       VALUES ($1, $2, 2, 12, 24, 20, 4)`, [saleId, productId]);

    // Ticket standard payé, anonyme (sans client).
    anonSaleId = (await p().query(
      `INSERT INTO sales (sale_number, user_id, subtotal, tax_amount, total, payment_method, payment_status, sale_type, store_id)
       VALUES ($1, $2, 12, 0, 12, 'cash', 'paid', 'standard', $3) RETURNING id`,
      [`T-AN-${RUN}`.slice(0, 20), userId, storeId])).rows[0].id;
    await p().query(
      `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal, tax_rate, tax_amount)
       VALUES ($1, $2, 1, 12, 12, 0, 0)`, [anonSaleId, productId]);
  });

  afterAll(async () => {
    const cc = await p().connect();
    try {
      await cc.query(`SET session_replication_role = 'replica'`);
      await cc.query(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE store_id = $1)`, [storeId]).catch(() => undefined);
      await cc.query(`DELETE FROM invoices WHERE store_id = $1`, [storeId]).catch(() => undefined);
      await cc.query(`DELETE FROM sale_items WHERE sale_id IN ($1, $2)`, [saleId, anonSaleId]).catch(() => undefined);
      await cc.query(`DELETE FROM sales WHERE store_id = $1`, [storeId]).catch(() => undefined);
      await cc.query(`DELETE FROM products WHERE id = $1`, [productId]).catch(() => undefined);
      await cc.query(`DELETE FROM customers WHERE id = $1`, [customerId]).catch(() => undefined);
      await cc.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
      await cc.query(`DELETE FROM stores WHERE id = $1`, [storeId]).catch(() => undefined);
    } finally {
      await cc.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      cc.release();
    }
    await closeTestPool();
  });

  it('émet une facture payée reprenant les lignes du ticket', async () => {
    const inv = await invoiceRepository.createFromSale(saleId, undefined, userId);
    expect(inv.invoice_type).toBe('emitted');
    expect(inv.kind).toBe('invoice');
    expect(inv.source_sale_id).toBe(saleId);
    expect(inv.status).toBe('paid');
    expect(inv.payment_status).toBe('paid');
    expect(Number(inv.amount)).toBe(20);        // HT = 24 − 4
    expect(Number(inv.tax_amount)).toBe(4);      // TVA 20 % incluse
    expect(Number(inv.total_amount)).toBe(24);
    expect(Number(inv.paid_amount)).toBe(24);
    const items = (await p().query(`SELECT * FROM invoice_items WHERE invoice_id = $1`, [inv.id])).rows;
    expect(items).toHaveLength(1);
    expect(Number(items[0].subtotal)).toBe(20);
    expect(Number(items[0].tva_rate)).toBe(20);
    expect(Number(items[0].tva_amount)).toBe(4);
  });

  it('ne produit AUCUNE écriture (la vente a déjà comptabilisé)', async () => {
    const inv = (await p().query(`SELECT * FROM invoices WHERE source_sale_id = $1`, [saleId])).rows[0];
    const entry = await fromInvoice(p() as never, inv as unknown as InvoiceRow);
    expect(entry).toBeNull();
  });

  it('refuse de facturer deux fois le même ticket', async () => {
    await expect(invoiceRepository.createFromSale(saleId, undefined, userId)).rejects.toThrow(/déjà la facture/);
  });

  it('exige un client pour un ticket anonyme, puis l\'accepte', async () => {
    await expect(invoiceRepository.createFromSale(anonSaleId, undefined, userId)).rejects.toThrow(/choisissez le client/);
    const inv = await invoiceRepository.createFromSale(anonSaleId, customerId, userId);
    expect(inv.customer_id).toBe(customerId);
    expect(inv.source_sale_id).toBe(anonSaleId);
  });
});
