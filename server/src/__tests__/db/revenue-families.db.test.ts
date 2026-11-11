/**
 * Phase 5.3 (mig 481) — comptes de produits par famille.
 *
 * Le générateur d'écritures ventile le CA par compte de produit, résolu
 * ligne → produit → catégorie → famille → family_revenue_accounts (défaut 7111).
 * On vérifie :
 *   - le repo (list / upsert / remove) et le refus d'un compte inconnu ;
 *   - fromSale ventile sur plusieurs comptes, l'écriture reste équilibrée ;
 *   - sans mapping, une seule ligne 7111 (non-régression) ;
 *   - fromInvoice (facture client) ventile de même.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';
import { saleRepository } from '../../repositories/sale.repository.js';
import { familyRevenueAccountRepository } from '../../repositories/accounting.repository.js';
import { fromSale, fromInvoice, type SaleRow, type InvoiceRow } from '../../services/journal-generator.service.js';

describe.skipIf(!hasTestDb)('Comptes de produits par famille — repo et ventilation', () => {
  const p = () => testPool();
  const famBoul = `Boulangerie-${RUN}`.slice(0, 60);
  const famPat = `Pâtisserie-${RUN}`.slice(0, 60);
  let storeId: string;
  let userId: string;
  let catBoul: number;
  let catPat: number;
  let prodBoul: string;  // famille Boulangerie → défaut 7111
  let prodPat: string;   // famille Pâtisserie → mappée 7112

  beforeAll(async () => {
    storeId = (await p().query(`INSERT INTO stores (name, city) VALUES ($1, 'Test') RETURNING id`, [`Mag Fam ${RUN}`])).rows[0].id;
    userId = (await p().query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, store_id)
       VALUES ($1, 'x', 'Test', 'Caisse', 'admin', $2) RETURNING id`,
      [`fam-${RUN}@test.local`, storeId]
    )).rows[0].id;
    catBoul = (await p().query(
      `INSERT INTO categories (name, slug, family) VALUES ($1, $2, $3) RETURNING id`,
      [`Pains ${RUN}`, `pains-${RUN}`, famBoul])).rows[0].id;
    catPat = (await p().query(
      `INSERT INTO categories (name, slug, family) VALUES ($1, $2, $3) RETURNING id`,
      [`Entremets ${RUN}`, `entremets-${RUN}`, famPat])).rows[0].id;
    const mk = async (name: string, catId: number) => (await p().query(
      `INSERT INTO products (name, slug, price, category_id) VALUES ($1, $2, 100, $3) RETURNING id`,
      [`${name} ${RUN}`, `${name.toLowerCase()}-${RUN}`, catId])).rows[0].id;
    prodBoul = await mk('Pain', catBoul);
    prodPat = await mk('Tarte', catPat);
    // La Pâtisserie est mappée sur 7112 (compte créé ad hoc pour le test).
    await p().query(
      `INSERT INTO family_revenue_accounts (family, account_code, label) VALUES ($1, '7112', 'Ventes pâtisserie')
       ON CONFLICT (family) DO UPDATE SET account_code = EXCLUDED.account_code`, [famPat]);
  });

  afterAll(async () => {
    await p().query(`DELETE FROM sales WHERE store_id = $1`, [storeId]).catch(() => undefined);
    await p().query(`DELETE FROM family_revenue_accounts WHERE family = ANY($1)`, [[famBoul, famPat]]).catch(() => undefined);
    await p().query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [[prodBoul, prodPat]]).catch(() => undefined);
    await p().query(`DELETE FROM categories WHERE id = ANY($1)`, [[catBoul, catPat]]).catch(() => undefined);
    await p().query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
    await p().query(`DELETE FROM stores WHERE id = $1`, [storeId]).catch(() => undefined);
    await closeTestPool();
  });

  it('upsert / list / remove, refuse un compte inconnu', async () => {
    await familyRevenueAccountRepository.upsert(famBoul, '7111');
    const list = await familyRevenueAccountRepository.list();
    const boul = list.find(r => r.family === famBoul);
    expect(boul?.account_code).toBe('7111');
    expect(Number(boul?.category_count)).toBeGreaterThanOrEqual(1);
    await expect(familyRevenueAccountRepository.upsert(famBoul, '9999')).rejects.toThrow();
    await familyRevenueAccountRepository.remove(famBoul);
    const after = (await familyRevenueAccountRepository.list()).find(r => r.family === famBoul);
    expect(after?.account_code ?? null).toBeNull();  // retour au défaut 7111
  });

  it('fromSale ventile le CA par compte, écriture équilibrée', async () => {
    const sale = await saleRepository.create({
      userId, storeId,
      subtotal: 200, taxAmount: 0, discountAmount: 0, total: 200,
      paymentMethod: 'cash', paymentStatus: 'paid', skipStockDeduction: true,
      items: [
        { productId: prodBoul, quantity: 1, unitPrice: 100, subtotal: 100 },
        { productId: prodPat, quantity: 1, unitPrice: 100, subtotal: 100 },
      ],
    });
    const row = (await p().query(`SELECT * FROM sales WHERE id = $1`, [sale.id])).rows[0] as SaleRow;
    const entry = await fromSale(p() as never, row);
    expect(entry).not.toBeNull();
    const lines = entry!.lines;
    const debit = Math.round(lines.reduce((s, l) => s + l.debit, 0) * 100) / 100;
    const credit = Math.round(lines.reduce((s, l) => s + l.credit, 0) * 100) / 100;
    expect(debit).toBe(credit);
    expect(debit).toBe(200);
    expect(lines.find(l => l.account_code === '7111')?.credit).toBe(100);  // Boulangerie → défaut
    expect(lines.find(l => l.account_code === '7112')?.credit).toBe(100);  // Pâtisserie → mappée
  });

  it('sans mapping : une seule ligne 7111 (non-régression)', async () => {
    const sale = await saleRepository.create({
      userId, storeId,
      subtotal: 100, taxAmount: 0, discountAmount: 0, total: 100,
      paymentMethod: 'cash', paymentStatus: 'paid', skipStockDeduction: true,
      items: [{ productId: prodBoul, quantity: 1, unitPrice: 100, subtotal: 100 }],
    });
    const row = (await p().query(`SELECT * FROM sales WHERE id = $1`, [sale.id])).rows[0] as SaleRow;
    const entry = await fromSale(p() as never, row);
    const revenue = entry!.lines.filter(l => l.account_code.startsWith('71'));
    expect(revenue).toHaveLength(1);
    expect(revenue[0].account_code).toBe('7111');
    expect(revenue[0].credit).toBe(100);
  });

  it('fromInvoice (facture client) ventile par famille', async () => {
    const customerId = (await p().query(
      `INSERT INTO customers (first_name, last_name) VALUES ('Fam', 'Client ${RUN}') RETURNING id`)).rows[0].id;
    // Une facture émise passe en « validated » par trigger ; ses lignes ne sont
    // modifiables que dans la transaction de création (created_at = now()).
    const c = await p().connect();
    let inv: Record<string, unknown>;
    try {
      await c.query('BEGIN');
      inv = (await c.query(
        `INSERT INTO invoices (invoice_number, invoice_type, customer_id, store_id, amount, tax_amount, total_amount, status, invoice_date)
         VALUES ($1, 'emitted', $2, $3, 200, 0, 200, 'pending', CURRENT_DATE) RETURNING *`,
        [`FV-FAM-${RUN}`.slice(0, 30), customerId, storeId])).rows[0];
      await c.query(
        `INSERT INTO invoice_items (invoice_id, product_id, quantity, unit_price, subtotal)
         VALUES ($1, $2, 1, 100, 100), ($1, $3, 1, 100, 100)`, [inv.id, prodBoul, prodPat]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    const entry = await fromInvoice(p() as never, inv as unknown as InvoiceRow);
    expect(entry).not.toBeNull();
    const lines = entry!.lines;
    const debit = Math.round(lines.reduce((s, l) => s + l.debit, 0) * 100) / 100;
    const credit = Math.round(lines.reduce((s, l) => s + l.credit, 0) * 100) / 100;
    expect(debit).toBe(credit);
    expect(lines.find(l => l.account_code === '7111')?.credit).toBe(100);
    expect(lines.find(l => l.account_code === '7112')?.credit).toBe(100);
    // Les lignes d'une facture validée sont verrouillées : on désactive les triggers
    // sur une même connexion le temps du nettoyage (base de test jetable).
    const cc = await p().connect();
    try {
      await cc.query(`SET session_replication_role = 'replica'`);
      await cc.query(`DELETE FROM invoices WHERE id = $1`, [inv.id]);  // cascade invoice_items
      await cc.query(`DELETE FROM customers WHERE id = $1`, [customerId]);
    } finally {
      await cc.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      cc.release();
    }
  });
});
