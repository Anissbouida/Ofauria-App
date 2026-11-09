/**
 * O2C phase 0.5c — à l'édition d'une commande, la réservation de stock suit la
 * nouvelle quantité : augmentation et ligne ajoutée réservent le delta (borné au
 * disponible, comme à la création), réduction et retrait relâchent l'excédent.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)("O2C 0.5c — réservation ajustée à l'édition de commande", () => {
  let orders: typeof import('../../repositories/order.repository.js').orderRepository;
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fx: Fixtures;
  const ids: Record<string, string> = {};
  const p = () => testPool();
  let n = 0;

  const reservedFor = async (orderId: string, productId: string) => Number((await p().query(
    `SELECT COALESCE(SUM(quantity), 0)::float8 AS q FROM order_stock_reservations
      WHERE order_id = $1 AND product_id = $2 AND status = 'reserved'`, [orderId, productId])).rows[0].q);
  const storeReserved = async (productId: string) => Number((await p().query(
    `SELECT COALESCE(reserved_quantity, 0)::float8 AS q FROM product_store_stock WHERE product_id = $1 AND store_id = $2`,
    [productId, fx.storeId])).rows[0].q);
  const edit = (orderId: string, items: { productId: string; quantity: number; unitPrice: number; subtotal: number }[]) => {
    const total = items.reduce((s, i) => s + i.subtotal, 0);
    return orders.update(orderId, { customerId: ids.customer, subtotal: total, taxAmount: 0, discountAmount: 0, total, items });
  };

  beforeAll(async () => {
    repos = await importRepositories();
    orders = (await import('../../repositories/order.repository.js')).orderRepository;
    fx = await createBaseFixtures();
    ids.customer = (await p().query(
      `INSERT INTO customers (first_name, last_name, customer_type) VALUES ('Res', '05c', 'particulier') RETURNING id`)).rows[0].id;
    ids.pa = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1, $2, 3) RETURNING id`, [`Res A ${RUN}`, `res-a-${RUN}`])).rows[0].id;
    ids.pb = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1, $2, 3) RETURNING id`, [`Res B ${RUN}`, `res-b-${RUN}`])).rows[0].id;
    fx.ids.products.push(ids.pa, ids.pb);
    // Stock magasin : A = 10, B = 3 (réservations posées dans le test).
    await p().query(
      `INSERT INTO product_store_stock (product_id, store_id, stock_quantity, reserved_quantity) VALUES ($1, $3, 10, 0), ($2, $3, 3, 0)`,
      [ids.pa, ids.pb, fx.storeId]);
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('augmentation réserve le delta borné au disponible, ligne ajoutée réservée, réduction/retrait relâchent', async () => {
    // Commande confirmée : 1 ligne A qty 4, avec une réservation initiale de 4.
    const o = (await p().query(
      `INSERT INTO orders (order_number, user_id, type, status, subtotal, total, store_id, customer_id)
       VALUES ($1, $2, 'custom', 'confirmed', 12, 12, $3, $4) RETURNING id`,
      [`R05C-${++n}-${RUN}`.slice(0, 20), fx.userId, fx.storeId, ids.customer])).rows[0].id;
    const la = (await p().query(
      `INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal) VALUES ($1, $2, 4, 3, 12) RETURNING id`, [o, ids.pa])).rows[0].id;
    await p().query(
      `INSERT INTO order_stock_reservations (order_id, order_item_id, product_id, store_id, quantity) VALUES ($1, $2, $3, $4, 4)`, [o, la, ids.pa, fx.storeId]);
    await p().query(`UPDATE product_store_stock SET reserved_quantity = 4 WHERE product_id = $1 AND store_id = $2`, [ids.pa, fx.storeId]);

    expect(await reservedFor(o, ids.pa)).toBe(4);

    // 4 → 8 : disponible = 10 − 4 = 6 ≥ 4, on réserve +4.
    await edit(o, [{ productId: ids.pa, quantity: 8, unitPrice: 3, subtotal: 24 }]);
    expect(await reservedFor(o, ids.pa)).toBe(8);
    expect(await storeReserved(ids.pa)).toBe(8);

    // 8 → 20 : disponible = 10 − 8 = 2, on ne réserve que +2 (borné au stock).
    await edit(o, [{ productId: ids.pa, quantity: 20, unitPrice: 3, subtotal: 60 }]);
    expect(await reservedFor(o, ids.pa)).toBe(10);
    expect(await storeReserved(ids.pa)).toBe(10);

    // Ligne B ajoutée (stock 3, demande 10) : on réserve 3.
    await edit(o, [{ productId: ids.pa, quantity: 20, unitPrice: 3, subtotal: 60 }, { productId: ids.pb, quantity: 10, unitPrice: 3, subtotal: 30 }]);
    expect(await reservedFor(o, ids.pb)).toBe(3);
    expect(await storeReserved(ids.pb)).toBe(3);

    // Réduction A 20 → 5 : on relâche l'excédent (10 → 5).
    await edit(o, [{ productId: ids.pa, quantity: 5, unitPrice: 3, subtotal: 15 }, { productId: ids.pb, quantity: 10, unitPrice: 3, subtotal: 30 }]);
    expect(await reservedFor(o, ids.pa)).toBe(5);
    expect(await storeReserved(ids.pa)).toBe(5);

    // Retrait de B : réservation relâchée, reserved_quantity revenu à 0.
    await edit(o, [{ productId: ids.pa, quantity: 5, unitPrice: 3, subtotal: 15 }]);
    expect(await reservedFor(o, ids.pb)).toBe(0);
    expect(await storeReserved(ids.pb)).toBe(0);
  });
});
