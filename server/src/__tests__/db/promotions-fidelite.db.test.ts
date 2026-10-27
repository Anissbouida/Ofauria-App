/**
 * Promotions et fidélité (mig 372), sur une vraie base migrée :
 *   - moteur : meilleure promotion par article, puis meilleure remise panier, code promo ;
 *   - vente : promotions tracées et comptées, points gagnés sur le montant payé ;
 *   - points utilisés (les plus anciens d'abord), retour partiel, expiration ;
 *   - écritures : dette de fidélité en 4491, contrepartie 7129, équilibrées.
 */
process.env.POS_ALLOW_NEGATIVE_STOCK = 'off';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, cleanupFixtures, RUN, type Fixtures, num,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Promotions et fidélité', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let saleRepository: typeof import('../../repositories/sale.repository.js').saleRepository;
  let returnRepository: typeof import('../../repositories/return.repository.js').returnRepository;
  let promotions: typeof import('../../services/promotions.js');
  let loyalty: typeof import('../../services/loyalty.js');
  let fx: Fixtures;
  let settingsBackup: Record<string, unknown>;
  const productIds: string[] = [];
  const promoIds: string[] = [];
  let customerId = '';
  let categoryId = 0;

  const makeProduct = async (slug: string, price: number, cat: number | null = null) => {
    const r = await testPool().query(
      `INSERT INTO products (name, slug, price, sale_type, sale_unit, category_id) VALUES ($1, $2, $3, 'jour', 'unit', $4) RETURNING id`,
      [`${slug} ${RUN}`, `${slug}-${RUN}`, price, cat]);
    productIds.push(r.rows[0].id);
    await testPool().query(
      `INSERT INTO product_store_stock (product_id, store_id, stock_quantity, stock_min_threshold, vitrine_quantity) VALUES ($1, $2, 0, 0, 100)`,
      [r.rows[0].id, fx.storeId]);
    return r.rows[0].id as string;
  };
  const makePromo = async (cols: Record<string, unknown>) => {
    const keys = Object.keys(cols);
    const r = await testPool().query(
      `INSERT INTO promotions (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, Object.values(cols));
    promoIds.push(r.rows[0].id);
    return r.rows[0].id as string;
  };
  const balance = async () => num((await testPool().query(`SELECT loyalty_points FROM customers WHERE id = $1`, [customerId])).rows[0].loyalty_points);
  const line = (productId: string, quantity: number, unitPrice: number, categoryId: number | null = null) =>
    ({ productId, categoryId, quantity, unit: 'unit' as const, unitPrice, subtotal: quantity * unitPrice });

  beforeAll(async () => {
    repos = await importRepositories();
    saleRepository = (await import('../../repositories/sale.repository.js')).saleRepository;
    returnRepository = (await import('../../repositories/return.repository.js')).returnRepository;
    promotions = await import('../../services/promotions.js');
    loyalty = await import('../../services/loyalty.js');
    fx = await createBaseFixtures();
    settingsBackup = (await testPool().query(`SELECT * FROM loyalty_settings WHERE id`)).rows[0];
    // Barème du test : 1 point par DH, 1 point = 0,10 DH, utilisable dès 10 points, 50 % du ticket.
    await testPool().query(`UPDATE loyalty_settings SET enabled = true, earn_points = 1, earn_per_amount = 1, point_value = 0.10, min_redeem_points = 10, max_redeem_pct = 50, expiry_months = 12 WHERE id`);
    const c = await testPool().query(`INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING id`, [`Promo ${RUN}`, `promo-${RUN}`]);
    categoryId = c.rows[0].id;
    const cust = await testPool().query(`INSERT INTO customers (first_name, last_name, loyalty_points, total_spent) VALUES ('Fidèle', $1, 0, 0) RETURNING id`, [RUN]);
    customerId = cust.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    const p = testPool();
    const run = async (sql: string, params: unknown[]) => { try { await p.query(sql, params); } catch { /* best effort */ } };
    await run(`UPDATE loyalty_settings SET enabled = $1, earn_points = $2, earn_per_amount = $3, point_value = $4, min_redeem_points = $5, max_redeem_pct = $6, expiry_months = $7 WHERE id`,
      ['enabled', 'earn_points', 'earn_per_amount', 'point_value', 'min_redeem_points', 'max_redeem_pct', 'expiry_months'].map(k => settingsBackup[k]));
    await run(`DELETE FROM loyalty_transactions WHERE customer_id = $1`, [customerId]);
    await run(`DELETE FROM document_promotions WHERE promotion_id = ANY($1::uuid[])`, [promoIds]);
    await run(`DELETE FROM promotions WHERE id = ANY($1::uuid[])`, [promoIds]);
    await run(`DELETE FROM sale_return_items WHERE product_id = ANY($1::uuid[])`, [productIds]);
    await run(`DELETE FROM sale_returns WHERE store_id = $1`, [fx.storeId]);
    await run(`DELETE FROM sale_items WHERE product_id = ANY($1::uuid[])`, [productIds]);
    await run(`DELETE FROM sales WHERE store_id = $1`, [fx.storeId]);
    await run(`DELETE FROM product_stock_transactions WHERE product_id = ANY($1::uuid[])`, [productIds]);
    await run(`DELETE FROM product_store_stock WHERE product_id = ANY($1::uuid[])`, [productIds]);
    await run(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [productIds]);
    await run(`DELETE FROM categories WHERE id = $1`, [categoryId]);
    await run(`DELETE FROM customers WHERE id = $1`, [customerId]);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('moteur : meilleure promotion par article, puis remise panier, code promo', async () => {
    const a = await makeProduct('promo-a', 10);
    const b = await makeProduct('promo-b', 30, categoryId);
    const bxgy = await makePromo({ name: `2+1 ${RUN}`, target: 'items', kind: 'buy_x_get_y', buy_qty: 2, get_qty: 1, product_ids: [a], store_id: fx.storeId });
    const pctCat = await makePromo({ name: `Cat -10 ${RUN}`, target: 'items', kind: 'percent', value: 10, category_ids: [categoryId], store_id: fx.storeId });
    // Moins bonne que -10 % sur B : ne doit pas être retenue.
    await makePromo({ name: `B -1 ${RUN}`, target: 'items', kind: 'amount', value: 1, product_ids: [b], store_id: fx.storeId });
    const cart = await makePromo({ name: `Code ${RUN}`, target: 'cart', kind: 'amount', value: 5, min_amount: 50, coupon_code: `C${RUN}`.toUpperCase().slice(0, 40), store_id: fx.storeId });

    const lines = [line(a, 3, 10), line(b, 2, 30, categoryId)];
    const noCode = await promotions.evaluate(lines, { channel: 'pos', storeId: fx.storeId });
    expect(noCode.lines[0]).toMatchObject({ discount: 10, promotionId: bxgy });   // 1 A offert sur 3
    expect(noCode.lines[1]).toMatchObject({ discount: 6, promotionId: pctCat });  // 10 % de 60
    expect(noCode.cartAmount).toBe(0);                                           // code non saisi
    expect(noCode.total).toBe(16);

    const withCode = await promotions.evaluate(lines, { channel: 'pos', storeId: fx.storeId, couponCode: `c${RUN}` });
    expect(withCode.cartAmount).toBe(5);                                          // 90 − 16 = 74 ≥ 50
    expect(withCode.total).toBe(21);
    expect(withCode.coupon?.status).toBe('applied');
    expect(withCode.applied.map(x => x.promotionId).sort()).toEqual([bxgy, pctCat, cart].sort());

    const bad = await promotions.evaluate(lines, { channel: 'pos', storeId: fx.storeId, couponCode: 'NEXISTEPAS' });
    expect(bad.coupon?.status).toBe('invalid');
    // Panier trop petit pour le code : conditions non remplies.
    const small = await promotions.evaluate([line(a, 1, 10)], { channel: 'pos', storeId: fx.storeId, couponCode: `C${RUN}` });
    expect(small.coupon?.status).toBe('not_applicable');
    // Canal commandes : ces promotions sont réservées à la caisse.
    expect((await promotions.evaluate(lines, { channel: 'orders', storeId: fx.storeId })).total).toBe(0);
    // Code valable mais battu par une remise automatique plus forte : non bloquant.
    const auto = await makePromo({ name: `Auto -8 ${RUN}`, target: 'cart', kind: 'amount', value: 8, store_id: fx.storeId });
    const beaten = await promotions.evaluate(lines, { channel: 'pos', storeId: fx.storeId, couponCode: `C${RUN}` });
    expect(beaten.coupon?.status).toBe('superseded');
    expect(beaten.cartAmount).toBe(8);
    await testPool().query(`UPDATE promotions SET is_active = false WHERE id = $1`, [auto]);
  });

  it('vente : promotions tracées, points gagnés sur le payé, dette en 4491', async () => {
    const p = await makeProduct('fid-1', 50);
    const promoId = await makePromo({ name: `Trace ${RUN}`, target: 'cart', kind: 'amount', value: 10, store_id: fx.storeId });
    const sale = await saleRepository.create({
      customerId, userId: fx.userId, storeId: fx.storeId,
      subtotal: 100, taxAmount: 0, discountAmount: 10, total: 90, paymentMethod: 'cash',
      promotionAmount: 10, appliedPromotions: [{ promotionId: promoId, label: 'Trace', amount: 10 }],
      items: [{ productId: p, quantity: 2, unitPrice: 50, subtotal: 100 }],
    });
    expect(num(sale.promotion_amount)).toBe(10);
    expect(await balance()).toBe(90);                                             // 1 pt / DH payé
    const promo = (await testPool().query(`SELECT uses_count FROM promotions WHERE id = $1`, [promoId])).rows[0];
    expect(promo.uses_count).toBe(1);
    const doc = await testPool().query(`SELECT amount FROM document_promotions WHERE sale_id = $1`, [sale.id]);
    expect(num(doc.rows[0].amount)).toBe(10);

    const earn = (await testPool().query(`SELECT * FROM loyalty_transactions WHERE sale_id = $1 AND kind = 'earn'`, [sale.id])).rows[0];
    expect(earn.points).toBe(90);
    expect(earn.remaining).toBe(90);
    expect(num(earn.amount)).toBe(9);                                             // 90 × 0,10
    const je = await testPool().query(
      `SELECT a.code, l.debit, l.credit FROM journal_entries e JOIN journal_entry_lines l ON l.journal_entry_id = e.id JOIN accounts a ON a.id = l.account_id
        WHERE e.source_kind = 'loyalty' AND e.source_id = $1 ORDER BY a.code`, [earn.id]);
    expect(je.rows.map(r => [r.code, num(r.debit), num(r.credit)])).toEqual([['4491', 0, 9], ['7129', 9, 0]]);
  });

  it('points utilisés : les plus anciens d\'abord, plafond du ticket, pas de double gain', async () => {
    const p = await makeProduct('fid-2', 40);
    // 40 DH de ticket : au plus 50 % = 20 DH = 200 points ; le client en a 90.
    const tooMuch = await loyalty.checkRedeem(repos.db, customerId, 300, 40);
    expect('error' in tooMuch).toBe(true);
    const ok = await loyalty.checkRedeem(repos.db, customerId, 50, 40);
    expect(ok).toEqual({ amount: 5 });
    const sale = await saleRepository.create({
      customerId, userId: fx.userId, storeId: fx.storeId,
      subtotal: 40, taxAmount: 0, discountAmount: 5, total: 35, paymentMethod: 'cash',
      loyaltyPointsUsed: 50, loyaltyAmount: 5,
      items: [{ productId: p, quantity: 1, unitPrice: 40, subtotal: 40 }],
    });
    // 90 − 50 utilisés + 35 gagnés sur le payé.
    expect(await balance()).toBe(75);
    const first = (await testPool().query(
      `SELECT remaining FROM loyalty_transactions WHERE customer_id = $1 AND kind = 'earn' ORDER BY created_at LIMIT 1`, [customerId])).rows[0];
    expect(first.remaining).toBe(40);                                             // 90 − 50 sur le plus ancien
    const redeem = (await testPool().query(`SELECT * FROM loyalty_transactions WHERE sale_id = $1 AND kind = 'redeem'`, [sale.id])).rows[0];
    expect(redeem.points).toBe(-50);
    const je = await testPool().query(
      `SELECT a.code, l.debit, l.credit FROM journal_entries e JOIN journal_entry_lines l ON l.journal_entry_id = e.id JOIN accounts a ON a.id = l.account_id
        WHERE e.source_kind = 'loyalty' AND e.source_id = $1 ORDER BY a.code`, [redeem.id]);
    expect(je.rows.map(r => [r.code, num(r.debit), num(r.credit)])).toEqual([['4491', 5, 0], ['7129', 0, 5]]);

    // Un second appel sur la même vente ne crédite rien.
    const client = await repos.db.getClient();
    try { expect(await loyalty.earnForSale(client, sale, fx.userId)).toBeNull(); } finally { client.release(); }
    expect(await balance()).toBe(75);
  });

  it('retour partiel : retire la part remboursée des points gagnés', async () => {
    const p = await makeProduct('fid-3', 20);
    const sale = await saleRepository.create({
      customerId, userId: fx.userId, storeId: fx.storeId,
      subtotal: 100, taxAmount: 0, discountAmount: 0, total: 100, paymentMethod: 'cash',
      items: [{ productId: p, quantity: 5, unitPrice: 20, subtotal: 100 }],
    });
    expect(await balance()).toBe(175);
    const item = (await testPool().query(`SELECT id FROM sale_items WHERE sale_id = $1`, [sale.id])).rows[0];
    await returnRepository.create({
      originalSaleId: sale.id, userId: fx.userId, storeId: fx.storeId, type: 'return', refundAmount: 40,
      items: [{ saleItemId: item.id, productId: p, quantity: 2, unitPrice: 20, subtotal: 40 }],
    });
    expect(await balance()).toBe(135);                                            // 40 % des 100 points
    const rev = (await testPool().query(`SELECT points FROM loyalty_transactions WHERE sale_id = $1 AND kind = 'reverse'`, [sale.id])).rows[0];
    expect(rev.points).toBe(-40);
  });

  it('encaissement en caisse : promotions recalculées, code promo, points, paiement mixte', async () => {
    const { saleController } = await import('../../controllers/sale.controller.js');
    const p = await makeProduct('caisse', 25);
    await testPool().query(
      `INSERT INTO product_lots (product_id, store_id, lot_number, quantity_total, vitrine_qty, produced_at, expires_at, status)
       VALUES ($1, $2, $3, 100, 100, NOW(), CURRENT_DATE + 10, 'active')`, [p, fx.storeId, `LC-${RUN}`.slice(0, 40)]);
    const code = `K${RUN}`.toUpperCase().slice(0, 40);
    await makePromo({ name: `Caisse -20 % ${RUN}`, target: 'items', kind: 'percent', value: 20, product_ids: [p], store_id: fx.storeId });
    await makePromo({ name: `Caisse code ${RUN}`, target: 'cart', kind: 'amount', value: 10, coupon_code: code, store_id: fx.storeId });
    const sess = await testPool().query(`INSERT INTO cash_register_sessions (user_id, store_id, status, opening_amount) VALUES ($1, $2, 'open', 0) RETURNING id`, [fx.userId, fx.storeId]);
    const call = async (body: Record<string, unknown>) => {
      const res = { code: 200, body: null as any, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.body = b; return this; } };
      await saleController.checkout({ body, user: { userId: fx.userId, storeId: fx.storeId, role: 'admin' } } as any, res as any);
      return res;
    };
    try {
      const before = await balance();
      // 4 × 25 = 100 ; −20 % = 80 ; code −10 = 70 ; remise caisse 5 = 65 ; 100 points (10 DH) = 55.
      const bad = await call({ customerId, items: [{ productId: p, quantity: 4 }], paymentMethod: 'cash', couponCode: 'FAUX', discountAmount: 0, loyaltyPoints: 0 });
      expect(bad.code).toBe(400);
      const tooMuch = await call({ customerId, items: [{ productId: p, quantity: 4 }], paymentMethod: 'cash', couponCode: code, discountAmount: 5, loyaltyPoints: 400 });
      expect(tooMuch.code).toBe(400);                                             // 40 DH > 50 % de 65
      const res = await call({
        customerId, items: [{ productId: p, quantity: 4 }], paymentMethod: 'mixed', cashAmount: 30, cardAmount: 25,
        couponCode: code.toLowerCase(), discountAmount: 5, loyaltyPoints: 100,
      });
      expect(res.body?.error?.message ?? null).toBeNull();
      expect(res.code).toBe(201);
      const sale = res.body.data;
      expect(num(sale.subtotal)).toBe(100);
      expect(num(sale.promotion_amount)).toBe(30);
      expect(num(sale.loyalty_amount)).toBe(10);
      expect(sale.loyalty_points_used).toBe(100);
      expect(num(sale.discount_amount)).toBe(45);                                 // 30 promos + 5 caisse + 10 points
      expect(num(sale.total)).toBe(55);
      expect(sale.coupon_code).toBe(code);
      const item = (await testPool().query(`SELECT promo_discount FROM sale_items WHERE sale_id = $1`, [sale.id])).rows[0];
      expect(num(item.promo_discount)).toBe(20);
      const docs = await testPool().query(`SELECT amount FROM document_promotions WHERE sale_id = $1 ORDER BY amount`, [sale.id]);
      expect(docs.rows.map(r => num(r.amount))).toEqual([10, 20]);
      expect(await balance()).toBe(before - 100 + 55);                            // utilisés puis gagnés sur 55 DH payés
    } finally {
      await testPool().query(`DELETE FROM sale_item_lots WHERE product_lot_id IN (SELECT id FROM product_lots WHERE product_id = $1)`, [p]);
      await testPool().query(`DELETE FROM product_lots WHERE product_id = $1`, [p]);
      await testPool().query(`UPDATE sales SET session_id = NULL WHERE session_id = $1`, [sess.rows[0].id]);
      await testPool().query(`DELETE FROM cash_register_sessions WHERE id = $1`, [sess.rows[0].id]);
    }
  });

  it('expiration : points échus retirés et dette soldée', async () => {
    const bucket = (await testPool().query(
      `UPDATE loyalty_transactions SET expires_at = now() - interval '1 day'
        WHERE id = (SELECT id FROM loyalty_transactions WHERE customer_id = $1 AND remaining > 0 ORDER BY created_at LIMIT 1)
        RETURNING remaining`, [customerId])).rows[0];
    const before = await balance();
    const r = await loyalty.expireDue();
    expect(r.items).toBeGreaterThanOrEqual(1);
    const exp = (await testPool().query(`SELECT points FROM loyalty_transactions WHERE customer_id = $1 AND kind = 'expire'`, [customerId])).rows;
    expect(exp.length).toBe(1);
    expect(await balance()).toBe(before + exp[0].points);
    expect(exp[0].points).toBe(-bucket.remaining);                                // reste du plus ancien lot
    const left = await testPool().query(`SELECT COALESCE(SUM(remaining), 0)::int AS n FROM loyalty_transactions WHERE customer_id = $1 AND remaining > 0`, [customerId]);
    expect(left.rows[0].n).toBe(await balance());                                 // lots disponibles = solde
  });
});
