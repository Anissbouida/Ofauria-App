/**
 * Cycle de vente (O2C), lot L6 (mig 452) — intégration base migrée.
 * Coût figé (lot → ligne de BL et de ticket, coût réel du plan), avance de
 * commande en 4421 reprise à la remise ou acquise à l'annulation, retour
 * comptabilisé, factures à établir et stock de produits finis en fin de
 * période, contrôles de clôture, facture client sans client refusée.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('O2C L6 — revenu, coût, clôture', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let notes: typeof import('../../repositories/delivery-note.repository.js').deliveryNoteRepository;
  let sales: typeof import('../../repositories/sale.repository.js').saleRepository;
  let returns: typeof import('../../repositories/return.repository.js').returnRepository;
  let invoices: typeof import('../../repositories/accounting.repository.js').invoiceRepository;
  let periodEnd: typeof import('../../repositories/period-end.repository.js').periodEndRepository;
  let ctrl: typeof import('../../controllers/order.controller.js');
  let fx: Fixtures;
  const ids: Record<string, string> = {};
  const p = () => testPool();
  let n = 0;

  const ledger = async (sourceId: string) => (await p().query(
    `SELECT a.code, jel.debit::float8 AS d, jel.credit::float8 AS c, je.source_detail
       FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id JOIN accounts a ON a.id = jel.account_id
      WHERE je.source_id = $1 AND je.status = 'posted' ORDER BY je.created_at, jel.line_order`, [sourceId])).rows;
  const lot = async (product: string, qty: number, cost: number | null) => (await p().query(
    `INSERT INTO product_lots (product_id, store_id, lot_number, quantity_total, backroom_qty, unit_cost)
     VALUES ($1, $2, $3, $4, $4, $5) RETURNING id`, [product, fx.storeId, `L6-${++n}-${RUN}`, qty, cost])).rows[0].id as string;
  const order = async (advance: number) => (await p().query(
    `INSERT INTO orders (order_number, user_id, type, status, subtotal, total, advance_amount, store_id)
     VALUES ($1, $2, 'custom', 'ready', 30, 30, $3, $4) RETURNING id`, [`L6-${++n}-${RUN}`.slice(0, 20), fx.userId, advance, fx.storeId])).rows[0].id as string;
  const call = async (fn: (req: any, res: any) => Promise<void>, body: Record<string, unknown>, params: Record<string, string>) => {
    const out = { status: 200, body: null as any };
    const res = { status(s: number) { out.status = s; return res; }, json(b: unknown) { out.body = b; return res; } };
    await fn({ body, params, query: {}, user: { userId: fx.userId, role: 'admin', storeId: fx.storeId } }, res);
    return out;
  };

  beforeAll(async () => {
    repos = await importRepositories();
    notes = (await import('../../repositories/delivery-note.repository.js')).deliveryNoteRepository;
    sales = (await import('../../repositories/sale.repository.js')).saleRepository;
    returns = (await import('../../repositories/return.repository.js')).returnRepository;
    invoices = (await import('../../repositories/accounting.repository.js')).invoiceRepository;
    periodEnd = (await import('../../repositories/period-end.repository.js')).periodEndRepository;
    ctrl = await import('../../controllers/order.controller.js');
    fx = await createBaseFixtures();
    ids.customer = (await p().query(
      `INSERT INTO customers (company_name, first_name, last_name, customer_type, billing_frequency) VALUES ($1, 'Hôtel', 'L6', 'professionnel', 'monthly') RETURNING id`,
      [`Hôtel L6 ${RUN}`])).rows[0].id;
    // Produit suivi par lots (DLC) ; coût standard manuel de 1 DH (fiche produit).
    ids.pa = (await p().query(`INSERT INTO products (name, slug, price, cost_price, shelf_life_days) VALUES ($1, $2, 3, 1, 3) RETURNING id`,
      [`Pain L6 ${RUN}`, `pain-l6-${RUN}`])).rows[0].id;
    fx.ids.products.push(ids.pa);
    await p().query(`INSERT INTO product_store_stock (product_id, store_id, stock_quantity, vitrine_quantity) VALUES ($1, $2, 100, 20)`, [ids.pa, fx.storeId]);
    ids.period = (await p().query(`SELECT fn_ensure_fiscal_period('2027-07-15'::date) AS id`)).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('coût réel du plan figé sur le lot ; coût du lot recopié sur la ligne de BL', async () => {
    // Plan de deux lignes, poids théoriques 1 × 10 et 3 × 10 : la ligne A porte 1/4 du coût réel.
    const plan = (await p().query(`INSERT INTO production_plans (plan_date, type, status, store_id, created_by) VALUES ('2027-07-02', 'daily', 'completed', $1, $2) RETURNING id`,
      [fx.storeId, fx.userId])).rows[0].id;
    fx.ids.plans.push(plan);
    const pb = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1, $2, 9) RETURNING id`, [`Gâteau L6 ${RUN}`, `gateau-l6-${RUN}`])).rows[0].id;
    fx.ids.products.push(pb);
    const item = async (product: string, theo: number) => (await p().query(
      `INSERT INTO production_plan_items (plan_id, product_id, planned_quantity, actual_quantity, theo_cout_complet_u) VALUES ($1, $2, 10, 10, $3) RETURNING id`,
      [plan, product, theo])).rows[0].id;
    const ia = await item(ids.pa, 1);
    await item(pb, 3);
    const lotA = (await p().query(
      `INSERT INTO product_lots (product_id, store_id, production_plan_id, plan_item_id, lot_number, quantity_total, backroom_qty)
       VALUES ($1, $2, $3, $4, $5, 10, 10) RETURNING id`, [ids.pa, fx.storeId, plan, ia, `L6-P-${RUN}`])).rows[0].id;
    // Pas encore de coût réel : coût standard (1 DH).
    expect(Number((await p().query(`SELECT unit_cost FROM product_lots WHERE id = $1`, [lotA])).rows[0].unit_cost)).toBe(1);
    // Coût réel 80 DH : 80 × 1/4 / 10 = 2 DH par pièce, figé sur le lot.
    await p().query(`INSERT INTO production_cout_reel (plan_id, cout_matieres) VALUES ($1, 80)`, [plan]);
    expect(Number((await p().query(`SELECT unit_cost FROM product_lots WHERE id = $1`, [lotA])).rows[0].unit_cost)).toBe(2);

    // BL de 12 : 10 du lot à 2 DH (DLC la plus proche… même DLC : ordre FEFO), 2 d'un lot à 1,50.
    await lot(ids.pa, 5, 1.5);
    const bl = await notes.create({ customerId: ids.customer, deliveryDate: '2027-07-05', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId: ids.pa, quantity: 12, unitPrice: 3, tvaRate: 20 }] }) as { id: string };
    ids.bl = bl.id;
    const lots = (await p().query(
      `SELECT SUM(l.quantity * pl.unit_cost)::float8 AS v FROM delivery_note_item_lots l JOIN delivery_note_items i ON i.id = l.delivery_note_item_id
         JOIN product_lots pl ON pl.id = l.product_lot_id WHERE i.delivery_note_id = $1`, [bl.id])).rows[0].v;
    const cost = Number((await p().query(`SELECT unit_cost FROM delivery_note_items WHERE delivery_note_id = $1`, [bl.id])).rows[0].unit_cost);
    expect(cost).toBeCloseTo(lots / 12, 4);
    // La marge voit la vente pro au coût figé.
    const m = (await p().query(
      `SELECT qty::float8 AS q, frozen_qty::float8 AS fq, frozen_cost::float8 AS fc FROM v_sales_margin_lines WHERE source = 'b2b' AND product_id = $1`, [ids.pa])).rows;
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ q: 12, fq: 12 });
    expect(m[0].fc).toBeCloseTo(lots, 2);
  });

  it('avance de commande en 4421, reprise en 7111 à la remise', async () => {
    const o = await order(10);
    const adv = await sales.create({ userId: fx.userId, storeId: fx.storeId, subtotal: 10, taxAmount: 0, discountAmount: 0, total: 10,
      paymentMethod: 'cash', orderId: o, saleType: 'advance', skipStockDeduction: true,
      items: [{ productId: ids.pa, quantity: 0, unitPrice: 3, subtotal: 0 }] } as Parameters<typeof sales.create>[0]) as { id: string };
    expect((await ledger(adv.id)).map(l => [l.code, l.d, l.c])).toEqual([['5161', 10, 0], ['4421', 0, 10]]);
    const rem = await sales.create({ userId: fx.userId, storeId: fx.storeId, subtotal: 20, taxAmount: 0, discountAmount: 0, total: 20,
      paymentMethod: 'cash', orderId: o, saleType: 'delivery', advanceAmount: 10, completeOrder: true, skipStockDeduction: true,
      items: [{ productId: ids.pa, quantity: 10, unitPrice: 3, subtotal: 30 }] } as Parameters<typeof sales.create>[0]) as { id: string };
    expect((await ledger(rem.id)).map(l => [l.code, l.d, l.c])).toEqual([['5161', 20, 0], ['4421', 10, 0], ['7111', 0, 30]]);
    // Coût figé sur le ticket de remise (sans lot consommé : coût standard).
    expect(Number((await p().query(`SELECT unit_cost FROM sale_items WHERE sale_id = $1`, [rem.id])).rows[0].unit_cost)).toBe(1);
  });

  it('commande annulée : l\'avance non remboursable devient un produit', async () => {
    const o = await order(8);
    await p().query(`UPDATE orders SET status = 'confirmed' WHERE id = $1`, [o]).catch(() => undefined);
    const adv = await sales.create({ userId: fx.userId, storeId: fx.storeId, subtotal: 8, taxAmount: 0, discountAmount: 0, total: 8,
      paymentMethod: 'cash', orderId: o, saleType: 'advance', skipStockDeduction: true,
      items: [{ productId: ids.pa, quantity: 0, unitPrice: 3, subtotal: 0 }] } as Parameters<typeof sales.create>[0]) as { id: string };
    const r = await call(ctrl.orderController.updateStatus, { status: 'cancelled', reason: 'Client absent' }, { id: o });
    expect(r.status).toBe(200);
    expect((await ledger(adv.id)).filter(l => l.source_detail === 'forfeit').map(l => [l.code, l.d, l.c])).toEqual([['4421', 8, 0], ['7111', 0, 8]]);
  });

  it('retour en caisse : la somme rendue annule du chiffre d\'affaires', async () => {
    const sale = await sales.create({ userId: fx.userId, storeId: fx.storeId, subtotal: 6, taxAmount: 0, discountAmount: 0, total: 6,
      paymentMethod: 'cash', skipStockDeduction: true,
      items: [{ productId: ids.pa, quantity: 2, unitPrice: 3, subtotal: 6 }] } as Parameters<typeof sales.create>[0]) as { id: string };
    const item = (await p().query(`SELECT id FROM sale_items WHERE sale_id = $1`, [sale.id])).rows[0].id;
    const ret = await returns.create({ originalSaleId: sale.id, userId: fx.userId, storeId: fx.storeId, type: 'return', refundAmount: 3,
      items: [{ saleItemId: item, productId: ids.pa, quantity: 1, unitPrice: 3, subtotal: 3 }] }) as { id: string };
    expect((await ledger(ret.id)).map(l => [l.code, l.d, l.c])).toEqual([['7111', 3, 0], ['5161', 0, 3]]);
  });

  it('fin de période : factures à établir extournées le lendemain, stock de produits finis, contrôles de clôture', async () => {
    const check = async (code: string) => Number((await p().query(`SELECT item_count FROM fn_close_checklist($1) WHERE code = $2`, [ids.period, code])).rows[0].item_count);
    expect(await check('customer_invoices_unposted')).toBe(0);

    const unbilled = await periodEnd.unbilled(ids.period);
    expect(unbilled.some((u: { delivery_note_id: string }) => u.delivery_note_id === ids.bl)).toBe(true);
    const f1 = await periodEnd.fae(ids.period, fx.userId);
    expect(f1.amount).toBeGreaterThanOrEqual(36);
    const e = await ledger(f1.id);
    expect(e.filter(l => !l.source_detail).map(l => [l.code, l.d, l.c])).toEqual([['3427', f1.amount, 0], ['7111', 0, f1.amount]]);
    expect(e.filter(l => l.source_detail === 'reversal').map(l => [l.code, l.d, l.c])).toEqual([['3427', 0, f1.amount], ['7111', f1.amount, 0]]);
    expect(await check('o2c_unbilled_deliveries')).toBe(0);
    // Recalcul : l'opération précédente est extournée et remplacée.
    const f2 = await periodEnd.fae(ids.period, fx.userId);
    expect((await p().query(`SELECT superseded_at FROM period_end_operations WHERE id = $1`, [f1.id])).rows[0].superseded_at).not.toBeNull();
    // Écritures d'origine extournées (statut reversed), leurs extournes passées.
    expect((await p().query(`SELECT count(*)::int AS c FROM journal_entries WHERE source_id = $1 AND status = 'posted' AND source_kind <> 'reversal'`, [f1.id])).rows[0].c).toBe(0);
    expect(f2.amount).toBe(f1.amount);

    const s = await periodEnd.fgStock(ids.period, fx.userId);
    expect(s.amount).toBeGreaterThan(0);
    const ls = await ledger(s.id);
    if (s.delta > 0) expect(ls.map(l => [l.code, l.d, l.c])).toEqual([['3151', s.delta, 0], ['7132', 0, s.delta]]);
    if (s.delta < 0) expect(ls.map(l => [l.code, l.d, l.c])).toEqual([['7132', -s.delta, 0], ['3151', 0, -s.delta]]);
    expect(await check('fg_stock_not_valued')).toBe(0);
  });

  it('facture client sans client : refusée', async () => {
    await expect(invoices.create({ invoiceType: 'emitted', invoiceDate: '2027-07-10', amount: 10, createdBy: fx.userId,
      items: [{ description: 'Prestation', quantity: 1, unitPrice: 10, subtotal: 10 }] })).rejects.toMatchObject({ statusCode: 400 });
  });
});
