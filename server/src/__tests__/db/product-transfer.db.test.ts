/**
 * Phase 7.4 (mig 490) — transferts de produits finis entre sites.
 *
 * Un transfert laisse une pièce et deux mouvements : le stock sort du site source et
 * entre au site destination. Un transfert au-delà du stock source est refusé.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';
import { productTransferRepository } from '../../repositories/product-transfer.repository.js';

describe.skipIf(!hasTestDb)('Transfert de produits finis entre sites', () => {
  const p = () => testPool();
  let fromStore: string;
  let toStore: string;
  let userId: string;
  let productId: string;
  let transferId: string;

  beforeAll(async () => {
    fromStore = (await p().query(`INSERT INTO stores (name, city, kind) VALUES ($1,'T','warehouse') RETURNING id`, [`From ${RUN}`])).rows[0].id;
    toStore = (await p().query(`INSERT INTO stores (name, city, kind) VALUES ($1,'T','shop') RETURNING id`, [`To ${RUN}`])).rows[0].id;
    userId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,'x','T','R','admin') RETURNING id`, [`tr-${RUN}@test.local`])).rows[0].id;
    productId = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1,$2,10) RETURNING id`, [`Prod Tr ${RUN}`, `prod-tr-${RUN}`])).rows[0].id;
    await p().query(`INSERT INTO product_store_stock (product_id, store_id, stock_quantity) VALUES ($1,$2,100)`, [productId, fromStore]);
  });

  afterAll(async () => {
    await p().query(`DELETE FROM product_stock_transactions WHERE product_id = $1`, [productId]).catch(() => undefined);
    await p().query(`DELETE FROM product_transfer_items WHERE transfer_id = $1`, [transferId]).catch(() => undefined);
    await p().query(`DELETE FROM product_transfers WHERE id = $1`, [transferId]).catch(() => undefined);
    await p().query(`DELETE FROM product_store_stock WHERE product_id = $1`, [productId]).catch(() => undefined);
    await p().query(`DELETE FROM products WHERE id = $1`, [productId]).catch(() => undefined);
    await p().query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
    await p().query(`DELETE FROM stores WHERE id = ANY($1)`, [[fromStore, toStore]]).catch(() => undefined);
    await closeTestPool();
  });

  it('déplace le stock et laisse une pièce + deux mouvements', async () => {
    const t = await productTransferRepository.create({ fromStoreId: fromStore, toStoreId: toStore, createdBy: userId,
      items: [{ productId, quantity: 30 }] });
    transferId = t.id;
    expect(String(t.number)).toMatch(/^TR-/);
    const from = (await p().query(`SELECT stock_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`, [productId, fromStore])).rows[0];
    const to = (await p().query(`SELECT stock_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`, [productId, toStore])).rows[0];
    expect(Number(from.stock_quantity)).toBe(70);
    expect(Number(to.stock_quantity)).toBe(30);
    const mv = (await p().query(`SELECT type, quantity_change FROM product_stock_transactions WHERE reference_id = $1 ORDER BY type`, [transferId])).rows;
    expect(mv).toHaveLength(2);
    expect(mv.find(m => m.type === 'transfer_in')).toBeTruthy();
    expect(mv.find(m => m.type === 'transfer_out')).toBeTruthy();
  });

  it('refuse un transfert au-delà du stock source', async () => {
    await expect(productTransferRepository.create({ fromStoreId: fromStore, toStoreId: toStore, createdBy: userId,
      items: [{ productId, quantity: 999 }] })).rejects.toThrow(/insuffisant/);
  });
});
