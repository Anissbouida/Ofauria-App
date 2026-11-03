/**
 * Cycle de vente (O2C), lot L1 (mig 440) — intégration base migrée.
 * Sortie de stock et lots à l'expédition : BL professionnel, annulation, remise
 * de commande depuis la réserve, retours, traçabilité aval.
 *
 * DLC à J+2 et plus : le fuseau de la session de test peut différer de celui de
 * l'application (Casablanca) autour de minuit.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('O2C L1 — sortie de stock et lots à l\'expédition', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let notes: typeof import('../../repositories/delivery-note.repository.js').deliveryNoteRepository;
  let sales: typeof import('../../repositories/sale.repository.js').saleRepository;
  let returns: typeof import('../../repositories/return.repository.js').returnRepository;
  let trace: typeof import('../../repositories/traceability.repository.js').traceabilityRepository;
  let fx: Fixtures;
  const ids: Record<string, string> = {};
  const p = () => testPool();
  const lot = async (tag: string, d: { backroom?: number; vitrine?: number; days: number; etat?: string }) => (await p().query(
    `INSERT INTO product_lots (product_id, store_id, lot_number, quantity_total, backroom_qty, vitrine_qty, produced_at, expires_at, status, etat_thermique)
     VALUES ($1, $2, $3, $4, $5, $6, now(), CURRENT_DATE + $7::int, 'active', $8) RETURNING id`,
    [ids.product, fx.storeId, `${tag}-${RUN}`.slice(0, 40), (d.backroom ?? 0) + (d.vitrine ?? 0), d.backroom ?? 0, d.vitrine ?? 0, d.days, d.etat ?? 'frais'])).rows[0].id as string;
  const lotQty = async (id: string) => (await p().query(
    `SELECT backroom_qty::float8 AS b, vitrine_qty::float8 AS v, sold_qty::float8 AS s FROM product_lots WHERE id = $1`, [id])).rows[0];
  const stock = async (productId = ids.product) => (await p().query(
    `SELECT stock_quantity::float8 AS s, vitrine_quantity::float8 AS v FROM product_store_stock WHERE product_id = $1 AND store_id = $2`, [productId, fx.storeId])).rows[0];

  beforeAll(async () => {
    repos = await importRepositories();
    notes = (await import('../../repositories/delivery-note.repository.js')).deliveryNoteRepository;
    sales = (await import('../../repositories/sale.repository.js')).saleRepository;
    returns = (await import('../../repositories/return.repository.js')).returnRepository;
    trace = (await import('../../repositories/traceability.repository.js')).traceabilityRepository;
    fx = await createBaseFixtures();
    ids.customer = (await p().query(`INSERT INTO customers (company_name, first_name, last_name, customer_type) VALUES ($1, 'Hôtel', 'L1', 'professionnel') RETURNING id`, [`Hôtel L1 ${RUN}`])).rows[0].id;
    ids.product = (await p().query(`INSERT INTO products (name, slug, price, shelf_life_days) VALUES ($1, $2, 3, 2) RETURNING id`, [`Croissant L1 ${RUN}`, `croissant-l1-${RUN}`])).rows[0].id;
    ids.resale = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1, $2, 8) RETURNING id`, [`Jus L1 ${RUN}`, `jus-l1-${RUN}`])).rows[0].id;
    fx.ids.products.push(ids.product, ids.resale);
    ids.l1 = await lot('A', { backroom: 5, days: 2 });
    ids.l2 = await lot('B', { backroom: 10, days: 4 });
    ids.l3 = await lot('C', { vitrine: 4, days: 3 });
    ids.frozen = await lot('F', { backroom: 20, days: 1, etat: 'surgele' });
    ids.expired = await lot('X', { backroom: 5, days: -1 });
    await p().query(`INSERT INTO product_store_stock (product_id, store_id, stock_quantity, vitrine_quantity) VALUES ($1, $2, 40, 4), ($3, $2, 10, 0)`,
      [ids.product, fx.storeId, ids.resale]);
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  const bl = (items: { productId: string; quantity: number }[]) => notes.create({
    customerId: ids.customer, storeId: fx.storeId, createdBy: fx.userId,
    items: items.map(i => ({ ...i, unitPrice: 3, tvaRate: 0 })),
  });

  it('BL : lots FEFO de la réserve (périmés et surgelés exclus), stock et mouvements', async () => {
    const note = await bl([{ productId: ids.product, quantity: 12 }]);
    ids.note = note.id;
    expect(note.lots_tracked).toBe(true);
    expect(note.shipped_at).not.toBeNull();
    const detail = (await notes.findById(note.id))!;
    const lots = (detail.items[0].lots as { lot_id: string; quantity: string; source: string }[]).map(l => [l.lot_id, Number(l.quantity), l.source]);
    expect(lots).toEqual([[ids.l1, 5, 'backroom'], [ids.l2, 7, 'backroom']]);
    expect(detail.items[0].requires_lots).toBe(true);
    expect(await lotQty(ids.l1)).toEqual({ b: 0, v: 0, s: 5 });
    expect(await lotQty(ids.l2)).toEqual({ b: 3, v: 0, s: 7 });
    expect((await lotQty(ids.frozen)).b).toBe(20);
    expect((await lotQty(ids.expired)).b).toBe(5);
    expect(await stock()).toEqual({ s: 28, v: 4 });
    const moves = (await p().query(
      `SELECT kind, quantity::float8 AS q FROM product_lot_movements WHERE ref_id = $1 ORDER BY quantity`, [note.id])).rows;
    expect(moves).toEqual([{ kind: 'delivery', q: 5 }, { kind: 'delivery', q: 7 }]);
    const tx = (await p().query(`SELECT type, quantity_change::float8 AS q FROM product_stock_transactions WHERE reference_id = $1`, [note.id])).rows;
    expect(tx).toEqual([{ type: 'delivery', q: -12 }]);
    // Traçabilité aval : le client professionnel apparaît sur le lot.
    const out = await trace.lotSales(ids.l2);
    expect(out.find((r: { kind: string }) => r.kind === 'delivery')).toMatchObject({ delivery_note_number: note.number, quantity: 7 });
  });

  it('BL refusé si les lots valides ne couvrent pas la quantité ; rien n\'est sorti', async () => {
    // Restent valides : B 3 (réserve) + C 4 (vitrine) = 7.
    await expect(bl([{ productId: ids.product, quantity: 8 }])).rejects.toMatchObject({ statusCode: 409, code: 'LOTS_INSUFFISANTS' });
    expect(await lotQty(ids.l2)).toEqual({ b: 3, v: 0, s: 7 });
    expect(await stock()).toEqual({ s: 28, v: 4 });
  });

  it('produit de revente sans suivi par lots : sorti du stock sans lot', async () => {
    const note = await bl([{ productId: ids.resale, quantity: 3 }]);
    const detail = (await notes.findById(note.id))!;
    expect(detail.items[0].requires_lots).toBe(false);
    expect(detail.items[0].lots).toEqual([]);
    expect((await stock(ids.resale)).s).toBe(7);
  });

  it('la base refuse au COMMIT un BL suivi par lots dont une ligne n\'est pas couverte', async () => {
    const c = await p().connect();
    try {
      await c.query('BEGIN');
      const dn = (await c.query(
        `INSERT INTO delivery_notes (number, customer_id, store_id, status, lots_tracked) VALUES ($1, $2, $3, 'delivered', true) RETURNING id`,
        [`BLX-${RUN}`.slice(0, 20), ids.customer, fx.storeId])).rows[0].id;
      await c.query(
        `INSERT INTO delivery_note_items (delivery_note_id, product_id, description, quantity, unit_price, subtotal, requires_lots)
         VALUES ($1, $2, 'sans lot', 2, 3, 6, true)`, [dn, ids.product]);
      await expect(c.query('COMMIT')).rejects.toThrow(/non couvert par des lots/);
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
    }
  });

  it('annulation du BL : quantités remises dans leurs lots et en stock, client retiré de la traçabilité', async () => {
    await notes.cancel(ids.note, fx.userId);
    expect(await lotQty(ids.l1)).toEqual({ b: 5, v: 0, s: 0 });
    expect(await lotQty(ids.l2)).toEqual({ b: 10, v: 0, s: 0 });
    expect(await stock()).toEqual({ s: 40, v: 4 });
    const kinds = (await p().query(`SELECT kind, sum(quantity)::float8 AS q FROM product_lot_movements WHERE ref_id = $1 GROUP BY kind ORDER BY kind`, [ids.note])).rows;
    expect(kinds).toEqual([{ kind: 'delivery', q: 12 }, { kind: 'delivery_reversal', q: 12 }]);
    expect((await trace.lotSales(ids.l2)).filter((r: { kind: string }) => r.kind === 'delivery')).toEqual([]);
  });

  it('remise d\'une commande : sortie de la réserve avec ses lots, vitrine intacte', async () => {
    const order = (await p().query(
      `INSERT INTO orders (order_number, user_id, type, status, subtotal, total, store_id)
       VALUES ($1, $2, 'custom', 'ready', 6, 6, $3) RETURNING id`, [`L1-${RUN}`.slice(0, 20), fx.userId, fx.storeId])).rows[0].id;
    const sale = await sales.create({
      userId: fx.userId, storeId: fx.storeId, subtotal: 6, taxAmount: 0, discountAmount: 0, total: 6, paymentMethod: 'cash',
      items: [{ productId: ids.product, quantity: 2, unitPrice: 3, subtotal: 6 }], orderId: order, completeOrder: true,
    });
    const links = (await p().query(
      `SELECT sil.product_lot_id, sil.quantity::float8 AS q FROM sale_item_lots sil JOIN sale_items si ON si.id = sil.sale_item_id WHERE si.sale_id = $1`, [sale.id])).rows;
    expect(links).toEqual([{ product_lot_id: ids.l1, q: 2 }]);
    expect(await lotQty(ids.l1)).toEqual({ b: 3, v: 0, s: 2 });
    expect(await stock()).toEqual({ s: 38, v: 4 });
  });

  it('retour en caisse : traçabilité inversée (returned_qty) et article remis sur son lot', async () => {
    const sale = await sales.create({
      userId: fx.userId, storeId: fx.storeId, subtotal: 6, taxAmount: 0, discountAmount: 0, total: 6, paymentMethod: 'cash',
      items: [{ productId: ids.product, quantity: 2, unitPrice: 3, subtotal: 6 }],
    });
    const si = (await p().query(`SELECT id FROM sale_items WHERE sale_id = $1`, [sale.id])).rows[0].id;
    expect((await lotQty(ids.l3)).v).toBe(2);
    await returns.create({
      originalSaleId: sale.id, userId: fx.userId, storeId: fx.storeId, type: 'return', refundAmount: 3,
      items: [{ saleItemId: si, productId: ids.product, quantity: 1, unitPrice: 3, subtotal: 3 }],
    });
    const sil = (await p().query(`SELECT quantity::float8 AS q, returned_qty::float8 AS r FROM sale_item_lots WHERE sale_item_id = $1`, [si])).rows[0];
    expect(sil).toEqual({ q: 2, r: 1 });
    expect(await lotQty(ids.l3)).toEqual({ b: 0, v: 3, s: 1 });
    const out = (await trace.lotSales(ids.l3)).filter((r: { sale_id: string }) => r.sale_id === sale.id);
    expect(out.length).toBeGreaterThan(0);
  });
});
