/**
 * Phase 7.5 (mig 491) — retour client professionnel.
 *
 *  - « remise en stock » : le lot d'origine est ré-incrémenté et le stock magasin remonte ;
 *  - « rebut » : rien ne revient (perte).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';
import { proReturnRepository } from '../../repositories/pro-return.repository.js';

describe.skipIf(!hasTestDb)('Retour client professionnel', () => {
  const p = () => testPool();
  let storeId: string;
  let userId: string;
  let customerId: string;
  let productId: string;
  let lotId: string;
  let returnId: string;

  beforeAll(async () => {
    storeId = (await p().query(`INSERT INTO stores (name, city) VALUES ($1,'T') RETURNING id`, [`Mag Pr ${RUN}`])).rows[0].id;
    userId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role, store_id) VALUES ($1,'x','P','R','admin',$2) RETURNING id`, [`pr-${RUN}@test.local`, storeId])).rows[0].id;
    customerId = (await p().query(`INSERT INTO customers (first_name, last_name, customer_type) VALUES ('Pro','Pr ${RUN}','professionnel') RETURNING id`)).rows[0].id;
    productId = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1,$2,20) RETURNING id`, [`Prod Pr ${RUN}`, `prod-pr-${RUN}`])).rows[0].id;
    lotId = (await p().query(
      `INSERT INTO product_lots (product_id, store_id, lot_number, quantity_total, backroom_qty, vitrine_qty, status)
       VALUES ($1,$2,$3,100,90,0,'active') RETURNING id`, [productId, storeId, `LR-${RUN}`.slice(0, 20)])).rows[0].id;
    await p().query(`INSERT INTO product_store_stock (product_id, store_id, stock_quantity) VALUES ($1,$2,0)`, [productId, storeId]);
  });

  afterAll(async () => {
    await p().query(`DELETE FROM product_stock_transactions WHERE product_id = $1`, [productId]).catch(() => undefined);
    await p().query(`DELETE FROM pro_return_items WHERE pro_return_id = $1`, [returnId]).catch(() => undefined);
    await p().query(`DELETE FROM pro_returns WHERE id = $1`, [returnId]).catch(() => undefined);
    await p().query(`DELETE FROM product_lots WHERE id = $1`, [lotId]).catch(() => undefined);
    await p().query(`DELETE FROM product_store_stock WHERE product_id = $1`, [productId]).catch(() => undefined);
    await p().query(`DELETE FROM products WHERE id = $1`, [productId]).catch(() => undefined);
    await p().query(`DELETE FROM customers WHERE id = $1`, [customerId]).catch(() => undefined);
    await p().query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
    await p().query(`DELETE FROM stores WHERE id = $1`, [storeId]).catch(() => undefined);
    await closeTestPool();
  });

  it('remet en stock avec le lot, et rebute sans retour de stock', async () => {
    const r = await proReturnRepository.create({
      customerId, deliveryNoteId: null, storeId, createdBy: userId,
      items: [
        { productId, productLotId: lotId, quantity: 10, unitPrice: 20, decision: 'restock' },
        { productId, productLotId: lotId, quantity: 4, unitPrice: 20, decision: 'scrap' },
      ],
    });
    returnId = r.id;
    expect(String(r.number)).toMatch(/^RET-/);
    const lot = (await p().query(`SELECT backroom_qty FROM product_lots WHERE id = $1`, [lotId])).rows[0];
    expect(Number(lot.backroom_qty)).toBe(100); // 90 + 10 remis, le rebut ne revient pas
    const ss = (await p().query(`SELECT stock_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`, [productId, storeId])).rows[0];
    expect(Number(ss.stock_quantity)).toBe(10); // seul le remis en stock
    const mv = (await p().query(`SELECT type, quantity_change FROM product_stock_transactions WHERE reference_id = $1`, [returnId])).rows;
    expect(mv).toHaveLength(1); // une seule entrée (le remis en stock), pas le rebut
    expect(mv[0].type).toBe('return');
  });
});
