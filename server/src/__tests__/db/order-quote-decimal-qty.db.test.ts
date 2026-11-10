/**
 * Phase 3.4 (mig 471) — quantités décimales sur les lignes de commande et de
 * devis. order_items.quantity et quote_items.quantity sont passés en
 * numeric(12,3) : une quantité fractionnaire (2,5 ; 0,75) doit se conserver
 * sans troncature, et le CHECK (quantity > 0) de quote_items reste actif.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, createBaseFixtures, createProductWithRecipe, cleanupFixtures, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Quantités décimales commande/devis', () => {
  let fx: Fixtures;
  let productId: string;
  const p = () => testPool();
  const orderIds: string[] = [];
  const quoteIds: string[] = [];

  beforeAll(async () => {
    fx = await createBaseFixtures();
    ({ productId } = await createProductWithRecipe(fx, { name: 'Article déci', price: 10, ingredients: [] }));
  });

  afterAll(async () => {
    for (const id of orderIds) {
      await p().query(`DELETE FROM order_items WHERE order_id = $1`, [id]).catch(() => undefined);
      await p().query(`DELETE FROM orders WHERE id = $1`, [id]).catch(() => undefined);
    }
    for (const id of quoteIds) {
      await p().query(`DELETE FROM quote_items WHERE quote_id = $1`, [id]).catch(() => undefined);
      await p().query(`DELETE FROM quotes WHERE id = $1`, [id]).catch(() => undefined);
    }
    await cleanupFixtures(fx);
    await closeTestPool();
  });

  it('une ligne de commande conserve une quantité décimale', async () => {
    const o = await p().query(
      `INSERT INTO orders (order_number, user_id, type, subtotal, total) VALUES ($1, $2, 'pro', 25, 25) RETURNING id`,
      [`CMD-${Date.now().toString(36)}`, fx.userId]);
    const orderId = o.rows[0].id;
    orderIds.push(orderId);
    await p().query(
      `INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal) VALUES ($1, $2, 2.5, 10, 25)`,
      [orderId, productId]);
    const q = (await p().query(`SELECT quantity FROM order_items WHERE order_id = $1`, [orderId])).rows[0].quantity;
    expect(Number(q)).toBe(2.5);
  });

  it('une ligne de devis conserve une quantité décimale et refuse 0', async () => {
    const d = await p().query(
      `INSERT INTO quotes (number, valid_until, prospect_name) VALUES ($1, CURRENT_DATE + 30, 'Prospect déci') RETURNING id`,
      [`DV-DEC-${Date.now()}`]);
    const quoteId = d.rows[0].id;
    quoteIds.push(quoteId);
    await p().query(
      `INSERT INTO quote_items (quote_id, product_id, quantity, unit_price, subtotal) VALUES ($1, $2, 0.75, 10, 7.5)`,
      [quoteId, productId]);
    const q = (await p().query(`SELECT quantity FROM quote_items WHERE quote_id = $1`, [quoteId])).rows[0].quantity;
    expect(Number(q)).toBe(0.75);
    // Le CHECK (quantity > 0) reste actif après l'élargissement de type.
    await expect(p().query(
      `INSERT INTO quote_items (quote_id, product_id, quantity, unit_price, subtotal) VALUES ($1, $2, 0, 10, 0)`,
      [quoteId, productId])).rejects.toThrow();
  });
});
