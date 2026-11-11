/**
 * Phase 8.1 (mig 493) — annulation de ticket avec autorisation.
 *
 *  - annule : extourne (sans erreur), restitue le stock vitrine, trace motif + approbateur ;
 *  - refuse sans motif ;
 *  - refuse un ticket déjà annulé ;
 *  - refuse si la caisse est clôturée.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';
import { saleRepository } from '../../repositories/sale.repository.js';

describe.skipIf(!hasTestDb)('Annulation de ticket', () => {
  const p = () => testPool();
  let storeId: string;
  let userId: string;
  let productId: string;
  let saleId: string;
  let closedSaleId: string;
  let closedSession: string;

  const makeSale = async (sessionId: string | null) => {
    const sid = (await p().query(
      `INSERT INTO sales (sale_number, user_id, subtotal, tax_amount, total, payment_method, payment_status, sale_type, store_id, session_id)
       VALUES ($1,$2,50,0,50,'cash','paid','standard',$3,$4) RETURNING id`,
      [`T-C-${RUN}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 20), userId, storeId, sessionId])).rows[0].id;
    await p().query(`INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal, tax_rate, tax_amount, unit) VALUES ($1,$2,5,10,50,0,0,'unit')`, [sid, productId]);
    return sid;
  };

  beforeAll(async () => {
    storeId = (await p().query(`INSERT INTO stores (name, city) VALUES ($1,'T') RETURNING id`, [`Mag Ca ${RUN}`])).rows[0].id;
    userId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role, store_id) VALUES ($1,'x','C','A','admin',$2) RETURNING id`, [`ca-${RUN}@test.local`, storeId])).rows[0].id;
    productId = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1,$2,10) RETURNING id`, [`Prod Ca ${RUN}`, `prod-ca-${RUN}`])).rows[0].id;
    await p().query(`INSERT INTO product_store_stock (product_id, store_id, vitrine_quantity, stock_quantity) VALUES ($1,$2,50,0)`, [productId, storeId]);
    saleId = await makeSale(null);
    closedSession = (await p().query(`INSERT INTO cash_register_sessions (user_id, store_id, status, closed_at) VALUES ($1,$2,'closed',now()) RETURNING id`, [userId, storeId])).rows[0].id;
    closedSaleId = await makeSale(closedSession);
  });

  afterAll(async () => {
    const cc = await p().connect();
    try {
      await cc.query(`SET session_replication_role = 'replica'`);
      await cc.query(`DELETE FROM product_stock_transactions WHERE product_id = $1`, [productId]).catch(() => undefined);
      await cc.query(`DELETE FROM sale_items WHERE sale_id IN ($1,$2)`, [saleId, closedSaleId]).catch(() => undefined);
      await cc.query(`DELETE FROM sales WHERE store_id = $1`, [storeId]).catch(() => undefined);
      await cc.query(`DELETE FROM cash_register_sessions WHERE id = $1`, [closedSession]).catch(() => undefined);
      await cc.query(`DELETE FROM product_store_stock WHERE product_id = $1`, [productId]).catch(() => undefined);
      await cc.query(`DELETE FROM products WHERE id = $1`, [productId]).catch(() => undefined);
      await cc.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
      await cc.query(`DELETE FROM stores WHERE id = $1`, [storeId]).catch(() => undefined);
    } finally {
      await cc.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      cc.release();
    }
    await closeTestPool();
  });

  it('refuse sans motif', async () => {
    await expect(saleRepository.cancel(saleId, { userId, approverId: userId, reason: '' })).rejects.toThrow(/[Mm]otif/);
  });

  it('annule : restitue le stock vitrine et trace', async () => {
    const row = await saleRepository.cancel(saleId, { userId, approverId: userId, reason: 'erreur de caisse' });
    expect(row.cancelled_at).toBeTruthy();
    expect(row.cancel_reason).toBe('erreur de caisse');
    expect(row.cancel_approved_by).toBe(userId);
    const ss = (await p().query(`SELECT vitrine_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`, [productId, storeId])).rows[0];
    expect(Number(ss.vitrine_quantity)).toBe(55); // 50 + 5 restitués
  });

  it('refuse un ticket déjà annulé', async () => {
    await expect(saleRepository.cancel(saleId, { userId, approverId: userId, reason: 'encore' })).rejects.toThrow(/déjà annulé/);
  });

  it('refuse si la caisse est clôturée', async () => {
    await expect(saleRepository.cancel(closedSaleId, { userId, approverId: userId, reason: 'trop tard' })).rejects.toThrow(/clôturée/);
  });
});
