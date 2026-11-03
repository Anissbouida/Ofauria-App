/**
 * Cycle de vente (O2C), lot L2 (mig 441) — intégration base migrée.
 * Livraisons partielles par plusieurs BL, reliquat soldé, tolérance de
 * sur-livraison, annulation qui rouvre la commande, cumul facturé, machine à
 * états, lignes stables, annulation propagée au plan de production.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('O2C L2 — flux documentaire et livraisons partielles', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let notes: typeof import('../../repositories/delivery-note.repository.js').deliveryNoteRepository;
  let orders: typeof import('../../repositories/order.repository.js').orderRepository;
  let invoices: typeof import('../../repositories/accounting.repository.js').invoiceRepository;
  let fx: Fixtures;
  const ids: Record<string, string> = {};
  const p = () => testPool();
  let n = 0;

  const order = async (status = 'ready') => {
    const o = (await p().query(
      `INSERT INTO orders (order_number, user_id, type, status, subtotal, total, store_id, customer_id)
       VALUES ($1, $2, 'custom', $3, 45, 45, $4, $5) RETURNING id`,
      [`L2-${++n}-${RUN}`.slice(0, 20), fx.userId, status, fx.storeId, ids.customer])).rows[0].id as string;
    const line = async (product: string, q: number) => (await p().query(
      `INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal) VALUES ($1, $2, $3, 3, $4) RETURNING id`,
      [o, product, q, q * 3])).rows[0].id as string;
    return { id: o, a: await line(ids.pa, 10), b: await line(ids.pb, 5) };
  };
  const lines = async (orderId: string) => (await p().query(
    `SELECT product_id, quantity::float8 AS q, qty_delivered::float8 AS d, qty_cancelled::float8 AS c, qty_invoiced::float8 AS i
       FROM order_items WHERE order_id = $1 ORDER BY quantity DESC`, [orderId])).rows;
  const status = async (orderId: string) => (await p().query(`SELECT status FROM orders WHERE id = $1`, [orderId])).rows[0].status as string;

  beforeAll(async () => {
    repos = await importRepositories();
    notes = (await import('../../repositories/delivery-note.repository.js')).deliveryNoteRepository;
    orders = (await import('../../repositories/order.repository.js')).orderRepository;
    invoices = (await import('../../repositories/accounting.repository.js')).invoiceRepository;
    fx = await createBaseFixtures();
    ids.customer = (await p().query(
      `INSERT INTO customers (company_name, first_name, last_name, customer_type, billing_frequency) VALUES ($1, 'Café', 'L2', 'professionnel', 'monthly') RETURNING id`,
      [`Café L2 ${RUN}`])).rows[0].id;
    // Produits de revente (sans suivi par lots) : on teste les cumuls, pas les lots (lot L1).
    ids.pa = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1, $2, 3) RETURNING id`, [`Pain A L2 ${RUN}`, `pain-a-l2-${RUN}`])).rows[0].id;
    ids.pb = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1, $2, 3) RETURNING id`, [`Pain B L2 ${RUN}`, `pain-b-l2-${RUN}`])).rows[0].id;
    fx.ids.products.push(ids.pa, ids.pb);
    await p().query(`INSERT INTO product_store_stock (product_id, store_id, stock_quantity) VALUES ($1, $3, 100), ($2, $3, 100)`, [ids.pa, ids.pb, fx.storeId]);
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('deux BL successifs : livraison partielle puis reliquat, cumuls et statut', async () => {
    const o = await order();
    const bl1 = await notes.createFromOrder(o.id, fx.userId, fx.storeId, { quantities: { [o.a]: 6 } }) as { id: string };
    expect(await status(o.id)).toBe('partially_delivered');
    expect(await lines(o.id)).toEqual([
      { product_id: ids.pa, q: 10, d: 6, c: 0, i: 0 }, { product_id: ids.pb, q: 5, d: 5, c: 0, i: 0 },
    ]);
    // Reste par défaut : 4 sur la ligne A, rien sur B.
    const remaining = await notes.orderLines(o.id);
    expect(remaining.map((l: { remaining: string }) => Number(l.remaining)).sort()).toEqual([0, 4]);
    expect((await notes.eligibleOrders(ids.customer)).some((x: { id: string }) => x.id === o.id)).toBe(true);
    const bl2 = await notes.createFromOrder(o.id, fx.userId, fx.storeId) as { id: string };
    expect(await status(o.id)).toBe('completed');
    expect((await lines(o.id))[0]).toMatchObject({ d: 10 });
    expect((await notes.eligibleOrders(ids.customer)).some((x: { id: string }) => x.id === o.id)).toBe(false);

    // Annuler le 2e BL rouvre la commande et le reliquat redevient livrable.
    await notes.cancel(bl2.id, fx.userId);
    expect(await status(o.id)).toBe('partially_delivered');
    expect((await lines(o.id))[0]).toMatchObject({ d: 6 });

    // Facturer le 1er BL : cumul facturé ; annuler la facture le fait redescendre.
    const inv = await notes.invoice({ deliveryNoteIds: [bl1.id], createdBy: fx.userId });
    expect((await lines(o.id)).map(l => l.i)).toEqual([6, 5]);
    await expect(notes.cancel(bl1.id, fx.userId)).rejects.toThrow(/livré et non facturé/);
    await p().query(`UPDATE invoices SET status = 'cancelled' WHERE id = $1`, [inv.id]);
    await notes.toInvoice({});   // libère les BL des factures annulées
    expect((await lines(o.id)).map(l => l.i)).toEqual([0, 0]);
  });

  it('sur-livraison bornée par la tolérance du client ; reliquat soldé', async () => {
    const o = await order();
    await expect(notes.createFromOrder(o.id, fx.userId, fx.storeId, { quantities: { [o.a]: 11 } })).rejects.toThrow(/au-delà du reste à livrer/);
    await p().query(`UPDATE customers SET over_delivery_tolerance_pct = 10 WHERE id = $1`, [ids.customer]);
    await notes.createFromOrder(o.id, fx.userId, fx.storeId, { quantities: { [o.a]: 11, [o.b]: 2 } });
    expect(await status(o.id)).toBe('partially_delivered');
    // Solder le reliquat de B (3) sans rien livrer de plus.
    const r = await notes.createFromOrder(o.id, fx.userId, fx.storeId, { quantities: { [o.a]: 0, [o.b]: 0 }, closeRemainder: true });
    expect(r).toEqual({ closed: true });
    expect(await status(o.id)).toBe('completed');
    expect(await lines(o.id)).toEqual([
      { product_id: ids.pa, q: 10, d: 11, c: 0, i: 0 }, { product_id: ids.pb, q: 5, d: 2, c: 3, i: 0 },
    ]);
    await p().query(`UPDATE customers SET over_delivery_tolerance_pct = 0 WHERE id = $1`, [ids.customer]);
  });

  it('machine à états : transitions interdites refusées par la base', async () => {
    const o = await order('ready');
    await expect(p().query(`UPDATE orders SET status = 'pending' WHERE id = $1`, [o.id])).rejects.toThrow(/Transition de commande interdite/);
    const c = await order('cancelled');
    await expect(p().query(`UPDATE orders SET status = 'ready' WHERE id = $1`, [c.id])).rejects.toThrow(/cancelled → ready/);
  });

  it('modification : lignes stables (identifiants conservés), refusée une fois livrée en partie', async () => {
    const o = await order('confirmed');
    await orders.update(o.id, {
      subtotal: 54, taxAmount: 0, discountAmount: 0, total: 54,
      items: [{ productId: ids.pa, quantity: 12, unitPrice: 3, subtotal: 36 }, { productId: ids.pb, quantity: 6, unitPrice: 3, subtotal: 18 }],
    });
    const after = (await p().query(`SELECT id, quantity FROM order_items WHERE order_id = $1 ORDER BY quantity DESC`, [o.id])).rows;
    expect(after.map(r => r.id)).toEqual([o.a, o.b]);
    expect(after.map(r => r.quantity)).toEqual([12, 6]);
    // Ligne retirée : seule B reste, A disparaît.
    await orders.update(o.id, { subtotal: 18, taxAmount: 0, discountAmount: 0, total: 18, items: [{ productId: ids.pb, quantity: 6, unitPrice: 3, subtotal: 18 }] });
    expect((await p().query(`SELECT id FROM order_items WHERE order_id = $1`, [o.id])).rows.map(r => r.id)).toEqual([o.b]);

    const d = await order('ready');
    await notes.createFromOrder(d.id, fx.userId, fx.storeId, { quantities: { [d.a]: 1, [d.b]: 0 } });
    await expect(orders.update(d.id, { subtotal: 3, taxAmount: 0, discountAmount: 0, total: 3, items: [{ productId: ids.pa, quantity: 1, unitPrice: 3, subtotal: 3 }] }))
      .resolves.toBeNull();   // statut partiellement livrée : non modifiable
  });

  it('annulation de commande : plan pas encore lancé annulé, plan lancé signalé', async () => {
    const o = await order('confirmed');
    const plan = (await p().query(
      `INSERT INTO production_plans (plan_date, type, status, store_id, order_id, created_by) VALUES (CURRENT_DATE + 1, 'daily', 'draft', $1, $2, $3) RETURNING id`,
      [fx.storeId, o.id, fx.userId])).rows[0].id;
    await p().query(`INSERT INTO production_plan_items (plan_id, product_id, planned_quantity) VALUES ($1, $2, 10)`, [plan, ids.pa]);
    const running = (await p().query(
      `INSERT INTO production_plans (plan_date, type, status, store_id, order_id, created_by) VALUES (CURRENT_DATE, 'daily', 'in_progress', $1, $2, $3) RETURNING id`,
      [fx.storeId, o.id, fx.userId])).rows[0].id;
    const res = await orders.updateStatus(o.id, 'cancelled', { userId: fx.userId, reason: 'Client absent' });
    expect(res.status).toBe('cancelled');
    expect(res.plan_warnings).toHaveLength(1);
    expect((await p().query(`SELECT status FROM production_plans WHERE id = $1`, [plan])).rows[0].status).toBe('cancelled');
    expect((await p().query(`SELECT status, cancellation_reason FROM production_plan_items WHERE plan_id = $1`, [plan])).rows[0])
      .toEqual({ status: 'cancelled', cancellation_reason: 'Commande annulée' });
    expect((await p().query(`SELECT status FROM production_plans WHERE id = $1`, [running])).rows[0].status).toBe('in_progress');
  });
});
