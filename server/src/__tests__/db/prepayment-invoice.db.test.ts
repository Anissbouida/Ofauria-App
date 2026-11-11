/**
 * Phase 5.4 (mig 482) — facture d'acompte client.
 *
 * Un acompte de commande (pro) donne une pièce numérotée (série FA, kind='prepayment'),
 * avec TVA, reprise ensuite sur la facture finale. On vérifie :
 *   - createOrderPrepayment émet une facture FA (3421 D / 4421 C + TVA) et refuse un
 *     acompte supérieur au reste à acompter ;
 *   - fromInvoice sur la facture finale reprend l'acompte : créance 3421 réduite du TTC,
 *     avance 4421 au débit, TVA régularisée, écriture équilibrée ;
 *   - sans acompte, la facture finale est inchangée (non-régression).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';
import { invoiceRepository } from '../../repositories/accounting.repository.js';
import { fromInvoice, type InvoiceRow } from '../../services/journal-generator.service.js';

describe.skipIf(!hasTestDb)('Facture d\'acompte — émission et reprise', () => {
  const p = () => testPool();
  let storeId: string;
  let userId: string;
  let customerId: string;
  let orderId: string;

  beforeAll(async () => {
    storeId = (await p().query(`INSERT INTO stores (name, city) VALUES ($1, 'Test') RETURNING id`, [`Mag Ac ${RUN}`])).rows[0].id;
    userId = (await p().query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, store_id)
       VALUES ($1, 'x', 'Dir', 'Ection', 'admin', $2) RETURNING id`, [`dir-${RUN}@test.local`, storeId])).rows[0].id;
    customerId = (await p().query(
      `INSERT INTO customers (first_name, last_name, customer_type) VALUES ('Pro', 'Client ${RUN}', 'professionnel') RETURNING id`)).rows[0].id;
    // Commande pro : 1000 HT + 200 TVA (20 %) = 1200 TTC.
    orderId = (await p().query(
      `INSERT INTO orders (order_number, customer_id, user_id, type, status, subtotal, tax_amount, total, store_id)
       VALUES ($1, $2, $3, 'pro', 'confirmed', 1000, 200, 1200, $4) RETURNING id`,
      [`CMD-AC-${RUN}`.slice(0, 20), customerId, userId, storeId])).rows[0].id;
  });

  afterAll(async () => {
    // Factures émises validées : triggers désactivés le temps du nettoyage (base jetable).
    const cc = await p().connect();
    try {
      await cc.query(`SET session_replication_role = 'replica'`);
      await cc.query(`DELETE FROM journal_entry_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE store_id = $1)`, [storeId]).catch(() => undefined);
      await cc.query(`DELETE FROM journal_entries WHERE store_id = $1`, [storeId]).catch(() => undefined);
      await cc.query(`DELETE FROM invoices WHERE store_id = $1`, [storeId]).catch(() => undefined);
      await cc.query(`DELETE FROM orders WHERE customer_id = $1`, [customerId]).catch(() => undefined);
      await cc.query(`DELETE FROM customers WHERE id = $1`, [customerId]).catch(() => undefined);
      await cc.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
      await cc.query(`DELETE FROM stores WHERE id = $1`, [storeId]).catch(() => undefined);
    } finally {
      await cc.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      cc.release();
    }
    await closeTestPool();
  });

  it('émet une facture d\'acompte numérotée avec TVA', async () => {
    const inv = await invoiceRepository.createOrderPrepayment(orderId, { percent: 30 }, userId);
    expect(inv.kind).toBe('prepayment');
    expect(String(inv.invoice_number)).toMatch(/^FA-/);
    expect(Number(inv.total_amount)).toBe(360);   // 30 % de 1200
    expect(Number(inv.amount)).toBe(300);         // HT
    expect(Number(inv.tax_amount)).toBe(60);      // TVA 20 %
    // Écriture : 3421 D 360 / 4421 C 300 + TVA C 60.
    const entry = await fromInvoice(p() as never, inv as unknown as InvoiceRow);
    const lines = entry!.lines;
    const debit = Math.round(lines.reduce((s, l) => s + l.debit, 0) * 100) / 100;
    const credit = Math.round(lines.reduce((s, l) => s + l.credit, 0) * 100) / 100;
    expect(debit).toBe(credit);
    expect(lines.find(l => l.account_code === '3421')?.debit).toBe(360);
    expect(lines.find(l => l.account_code === '4421')?.credit).toBe(300);
    expect(lines.find(l => /^4455/.test(l.account_code))?.credit).toBe(60);
  });

  it('refuse un acompte supérieur au reste à acompter', async () => {
    // Déjà 360 acomptés ; 900 de plus dépasserait 1200.
    await expect(invoiceRepository.createOrderPrepayment(orderId, { amount: 900 }, userId)).rejects.toThrow(/reste à acompter/);
  });

  it('reprend l\'acompte sur la facture finale, écriture équilibrée', async () => {
    // Facture finale (full) construite directement puis liée à l'acompte payé.
    const c = await p().connect();
    let finalInv: Record<string, unknown>;
    try {
      await c.query('BEGIN');
      finalInv = (await c.query(
        `INSERT INTO invoices (invoice_number, invoice_type, customer_id, order_id, invoice_date, amount, tax_amount, total_amount, status, created_by, store_id, kind)
         VALUES ($1, 'emitted', $2, $3, CURRENT_DATE, 1000, 200, 1200, 'pending', $4, $5, 'invoice') RETURNING *`,
        [`FE-AC-${RUN}`.slice(0, 20), customerId, orderId, userId, storeId])).rows[0];
      await c.query(
        `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, subtotal, tva_rate, tva_amount)
         VALUES ($1, 'Prestation', 1, 1000, 1000, 20, 200)`, [finalInv.id]);
      // L'acompte disponible de la commande est consommé par cette facture finale.
      await c.query(
        `UPDATE invoices SET prepayment_consumed_invoice_id = $1
          WHERE order_id = $2 AND kind = 'prepayment' AND status <> 'cancelled' AND prepayment_consumed_invoice_id IS NULL`,
        [finalInv.id, orderId]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }

    const entry = await fromInvoice(p() as never, finalInv as unknown as InvoiceRow);
    const lines = entry!.lines;
    const debit = Math.round(lines.reduce((s, l) => s + l.debit, 0) * 100) / 100;
    const credit = Math.round(lines.reduce((s, l) => s + l.credit, 0) * 100) / 100;
    expect(debit).toBe(credit);
    expect(debit).toBe(1200);
    expect(lines.find(l => l.account_code === '3421')?.debit).toBe(840);   // 1200 − 360 acompte
    expect(lines.find(l => l.account_code === '4421')?.debit).toBe(300);   // reprise HT
    expect(lines.find(l => l.account_code === '7111')?.credit).toBe(1000); // CA plein
    // TVA : 200 collectée au crédit, 60 régularisée au débit (déjà sur l'acompte).
    expect(lines.find(l => /^4455/.test(l.account_code) && l.credit > 0)?.credit).toBe(200);
    expect(lines.find(l => /^4455/.test(l.account_code) && l.debit > 0)?.debit).toBe(60);
  });

  it('sans acompte : facture finale inchangée (non-régression)', async () => {
    const other = (await p().query(
      `INSERT INTO orders (order_number, customer_id, user_id, type, status, subtotal, tax_amount, total, store_id)
       VALUES ($1, $2, $3, 'pro', 'confirmed', 500, 100, 600, $4) RETURNING id`,
      [`CMD-NA-${RUN}`.slice(0, 20), customerId, userId, storeId])).rows[0].id;
    const c = await p().connect();
    let finalInv: Record<string, unknown>;
    try {
      await c.query('BEGIN');
      finalInv = (await c.query(
        `INSERT INTO invoices (invoice_number, invoice_type, customer_id, order_id, invoice_date, amount, tax_amount, total_amount, status, created_by, store_id, kind)
         VALUES ($1, 'emitted', $2, $3, CURRENT_DATE, 500, 100, 600, 'pending', $4, $5, 'invoice') RETURNING *`,
        [`FE-NA-${RUN}`.slice(0, 20), customerId, other, userId, storeId])).rows[0];
      await c.query(`INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, subtotal, tva_rate, tva_amount) VALUES ($1, 'Prestation', 1, 500, 500, 20, 100)`, [finalInv.id]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }

    const entry = await fromInvoice(p() as never, finalInv as unknown as InvoiceRow);
    const lines = entry!.lines;
    expect(lines.find(l => l.account_code === '3421')?.debit).toBe(600);  // créance pleine
    expect(lines.find(l => l.account_code === '4421')).toBeUndefined();   // aucune reprise
  });
});
