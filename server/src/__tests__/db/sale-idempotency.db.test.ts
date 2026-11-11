/**
 * Phase 8.4 — socle hors-ligne : idempotence du checkout.
 *
 * Deux checkouts avec la même clé d'idempotence (rejeu après reconnexion) renvoient la
 * MÊME vente : pas de double encaissement ni de double sortie de stock.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';
import { saleRepository } from '../../repositories/sale.repository.js';

describe.skipIf(!hasTestDb)('Checkout idempotent', () => {
  const p = () => testPool();
  let storeId: string;
  let userId: string;
  let productId: string;
  const key = `idem-${RUN}`;
  let saleId: string;

  beforeAll(async () => {
    storeId = (await p().query(`INSERT INTO stores (name, city) VALUES ($1,'T') RETURNING id`, [`Mag Id ${RUN}`])).rows[0].id;
    userId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role, store_id) VALUES ($1,'x','I','D','admin',$2) RETURNING id`, [`id-${RUN}@test.local`, storeId])).rows[0].id;
    productId = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1,$2,10) RETURNING id`, [`Prod Id ${RUN}`, `prod-id-${RUN}`])).rows[0].id;
    await p().query(`INSERT INTO product_store_stock (product_id, store_id, vitrine_quantity, stock_quantity) VALUES ($1,$2,50,0)`, [productId, storeId]);
  });

  afterAll(async () => {
    const cc = await p().connect();
    try {
      await cc.query(`SET session_replication_role = 'replica'`);
      await cc.query(`DELETE FROM product_stock_transactions WHERE product_id = $1`, [productId]).catch(() => undefined);
      await cc.query(`DELETE FROM sale_items WHERE sale_id = $1`, [saleId]).catch(() => undefined);
      await cc.query(`DELETE FROM sales WHERE store_id = $1`, [storeId]).catch(() => undefined);
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

  const payload = () => ({
    userId, storeId, subtotal: 50, taxAmount: 0, discountAmount: 0, total: 50, paymentMethod: 'cash',
    items: [{ productId, quantity: 5, unitPrice: 10, subtotal: 50 }], idempotencyKey: key,
  });

  it('un rejeu avec la même clé renvoie la même vente', async () => {
    const first = await saleRepository.create(payload());
    saleId = first.id;
    const second = await saleRepository.create(payload());
    expect(second.id).toBe(first.id);
    const count = (await p().query(`SELECT count(*)::int AS n FROM sales WHERE idempotency_key = $1`, [key])).rows[0].n;
    expect(count).toBe(1);
    // Stock vitrine décrémenté une seule fois (50 − 5 = 45).
    const ss = (await p().query(`SELECT vitrine_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`, [productId, storeId])).rows[0];
    expect(Number(ss.vitrine_quantity)).toBe(45);
  });
});
