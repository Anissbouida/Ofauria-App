/**
 * Phase 8.3 — chèque et paiement mobile en caisse.
 *
 * La trésorerie d'une vente suit le moyen de règlement : chèque → 5111 (à encaisser),
 * mobile → 5141 (banque). Le caissier reste porté par sales.user_id.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';
import { fromSale, type SaleRow } from '../../services/journal-generator.service.js';

describe.skipIf(!hasTestDb)('Caisse — chèque et mobile', () => {
  const p = () => testPool();
  let storeId: string;
  let userId: string;
  let productId: string;
  const saleIds: string[] = [];

  const makeSale = async (method: string) => {
    const sid = (await p().query(
      `INSERT INTO sales (sale_number, user_id, subtotal, tax_amount, total, payment_method, payment_status, sale_type, store_id, paid_at)
       VALUES ($1,$2,100,0,100,$3,'paid','standard',$4, now()) RETURNING *`,
      [`T-PM-${RUN}-${method}`.slice(0, 20), userId, method, storeId])).rows[0];
    await p().query(`INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal, tax_rate, tax_amount, unit) VALUES ($1,$2,1,100,100,0,0,'unit')`, [sid.id, productId]);
    saleIds.push(sid.id);
    return sid;
  };

  beforeAll(async () => {
    storeId = (await p().query(`INSERT INTO stores (name, city) VALUES ($1,'T') RETURNING id`, [`Mag Pm ${RUN}`])).rows[0].id;
    userId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role, store_id) VALUES ($1,'x','P','M','admin',$2) RETURNING id`, [`pm-${RUN}@test.local`, storeId])).rows[0].id;
    productId = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1,$2,100) RETURNING id`, [`Prod Pm ${RUN}`, `prod-pm-${RUN}`])).rows[0].id;
  });

  afterAll(async () => {
    await p().query(`DELETE FROM sale_items WHERE sale_id = ANY($1)`, [saleIds]).catch(() => undefined);
    await p().query(`DELETE FROM sales WHERE store_id = $1`, [storeId]).catch(() => undefined);
    await p().query(`DELETE FROM products WHERE id = $1`, [productId]).catch(() => undefined);
    await p().query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
    await p().query(`DELETE FROM stores WHERE id = $1`, [storeId]).catch(() => undefined);
    await closeTestPool();
  });

  it('chèque : trésorerie en 5111', async () => {
    const s = await makeSale('check');
    const entry = await fromSale(p() as never, s as unknown as SaleRow);
    expect(entry!.lines.find(l => l.debit > 0)?.account_code).toBe('5111');
  });

  it('mobile : trésorerie en 5141', async () => {
    const s = await makeSale('mobile');
    const entry = await fromSale(p() as never, s as unknown as SaleRow);
    expect(entry!.lines.find(l => l.debit > 0)?.account_code).toBe('5141');
  });
});
