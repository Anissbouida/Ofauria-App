/**
 * Cycle de vente (O2C), lot L3 (mig 443) — intégration base migrée.
 * Encours unique, contrôle bloquant à l'expédition et dérogation motivée,
 * client bloqué, prix grille et dérogation de prix, plafonds de remise,
 * remise personnel imposée, commande + avance atomiques avec canal,
 * conversion de devis (brouillon refusé, pas de double conversion).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

type Res = { status: number; body: any };

describe.skipIf(!hasTestDb)('O2C L3 — crédit et prix', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let notes: typeof import('../../repositories/delivery-note.repository.js').deliveryNoteRepository;
  let quotes: typeof import('../../repositories/quote.repository.js').quoteRepository;
  let ctrl: typeof import('../../controllers/order.controller.js');
  let credit: typeof import('../../services/credit-control.js');
  let fx: Fixtures;
  const ids: Record<string, string> = {};
  const p = () => testPool();
  let n = 0;

  const call = async (fn: (req: any, res: any) => Promise<void>, body: Record<string, unknown>, role = 'admin', params: Record<string, string> = {}): Promise<Res> => {
    const out: Res = { status: 200, body: null };
    const res = { status(s: number) { out.status = s; return res; }, json(b: unknown) { out.body = b; return res; } };
    await fn({ body, params, query: {}, user: { userId: role === 'admin' ? fx.userId : ids[role], role, storeId: fx.storeId } }, res);
    return out;
  };
  const proOrder = async (customer: string, total: number, status = 'ready') => {
    const o = (await p().query(
      `INSERT INTO orders (order_number, user_id, type, status, subtotal, total, store_id, customer_id)
       VALUES ($1, $2, 'custom', $3, $4, $4, $5, $6) RETURNING id`,
      [`L3-${++n}-${RUN}`.slice(0, 20), fx.userId, status, total, fx.storeId, customer])).rows[0].id as string;
    await p().query(`INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal) VALUES ($1, $2, $3, 10, $4)`,
      [o, ids.pa, total / 10, total]);
    return o;
  };
  const events = async (customer: string) => (await p().query(
    `SELECT checkpoint, decision, document_id, decided_by, reason FROM credit_check_events WHERE customer_id = $1 ORDER BY created_at`, [customer])).rows;

  beforeAll(async () => {
    repos = await importRepositories();
    notes = (await import('../../repositories/delivery-note.repository.js')).deliveryNoteRepository;
    quotes = (await import('../../repositories/quote.repository.js')).quoteRepository;
    ctrl = await import('../../controllers/order.controller.js');
    credit = await import('../../services/credit-control.js');
    fx = await createBaseFixtures();
    for (const role of ['manager', 'cashier']) {
      ids[role] = (await p().query(
        `INSERT INTO users (email, password_hash, first_name, last_name, role, store_id) VALUES ($1, 'x', 'L3', $2, $2, $3) RETURNING id`,
        [`${role}-l3-${RUN}@test.local`, role, fx.storeId])).rows[0].id;
    }
    const cust = async (name: string, limit: number | null) => (await p().query(
      `INSERT INTO customers (company_name, first_name, last_name, customer_type, billing_frequency, credit_limit)
       VALUES ($1, 'Hôtel', 'L3', 'professionnel', 'monthly', $2) RETURNING id`, [`${name} ${RUN}`, limit])).rows[0].id as string;
    ids.expo = await cust('Expo L3', null);
    ids.capped = await cust('Plafond L3', 100);
    ids.held = await cust('Bloqué L3', null);
    await p().query(`UPDATE customers SET credit_hold = true, credit_hold_reason = 'Relance niveau 3' WHERE id = $1`, [ids.held]);
    ids.pa = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1, $2, 10) RETURNING id`, [`Pain L3 ${RUN}`, `pain-l3-${RUN}`])).rows[0].id;
    fx.ids.products.push(ids.pa);
    await p().query(`INSERT INTO product_store_stock (product_id, store_id, stock_quantity) VALUES ($1, $2, 1000)`, [ids.pa, fx.storeId]);
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('encours unique : factures ouvertes + BL non facturés + reste des commandes ouvertes', async () => {
    const expo = () => credit.customerExposure(repos.db, ids.expo);
    expect(await expo()).toBe(0);
    // Commande ouverte de 300 : comptée en entier tant que rien n'est livré.
    const o = await proOrder(ids.expo, 300);
    expect(await expo()).toBe(300);
    expect(await credit.customerExposure(repos.db, ids.expo, o)).toBe(0);
    // Livraison partielle (12 sur 30) : 120 HT + TVA du BL, 180 restent sur la commande.
    const items = (await p().query(`SELECT id FROM order_items WHERE order_id = $1`, [o])).rows;
    await notes.createFromOrder(o, fx.userId, fx.storeId, { quantities: { [items[0].id]: 12 } });
    const bl = Number((await p().query(
      `SELECT SUM(dni.subtotal + ROUND(dni.subtotal * COALESCE(dni.tva_rate, 0) / 100, 2)) AS t FROM delivery_note_items dni
         JOIN delivery_notes dn ON dn.id = dni.delivery_note_id WHERE dn.order_id = $1`, [o])).rows[0].t);
    expect(bl).toBeGreaterThanOrEqual(120);
    expect(await expo()).toBe(Math.round((bl + 180) * 100) / 100);
    // Facture client ouverte, payée en partie : le reste dû s'ajoute.
    await p().query(
      `INSERT INTO invoices (invoice_number, invoice_type, customer_id, invoice_date, amount, total_amount, paid_amount, status)
       VALUES ($1, 'emitted', $2, '2027-03-01', 200, 200, 50, 'partial')`, [`FE-L3-${RUN}`.slice(0, 30), ids.expo]);
    expect(await expo()).toBe(Math.round((bl + 180 + 150) * 100) / 100);
  });

  it('expédition : bloquée au-delà du plafond (refus tracé), dérogation motivée de la direction', async () => {
    const o = await proOrder(ids.capped, 300);
    await expect(notes.createFromOrder(o, fx.userId, fx.storeId)).rejects.toMatchObject({ statusCode: 409, code: 'CREDIT_BLOCKED' });
    // Rien n'est sorti : pas de BL, commande intacte, mais le refus est journalisé.
    expect((await p().query(`SELECT count(*)::int AS c FROM delivery_notes WHERE order_id = $1`, [o])).rows[0].c).toBe(0);
    expect(await events(ids.capped)).toEqual([{ checkpoint: 'ship', decision: 'block', document_id: null, decided_by: null, reason: null }]);

    const bl = await notes.createFromOrder(o, fx.userId, fx.storeId, { creditOverride: { userId: fx.userId, reason: 'Client historique, chèque reçu' } }) as { id: string };
    const ev = (await events(ids.capped)).at(-1);
    expect(ev).toEqual({ checkpoint: 'ship', decision: 'override', document_id: bl.id, decided_by: fx.userId, reason: 'Client historique, chèque reçu' });
    // Une dérogation sans motif est refusée par la base.
    await expect(p().query(
      `INSERT INTO credit_check_events (customer_id, document_type, checkpoint, exposure, decision, decided_by) VALUES ($1, 'order', 'ship', 0, 'override', $2)`,
      [ids.capped, fx.userId])).rejects.toThrow(/check/);
  });

  it('client bloqué : refusé même sans plafond, dès la prise de commande', async () => {
    const r = await credit.checkCredit(repos.db, { customerId: ids.held, amount: 10, checkpoint: 'create', documentType: 'order' });
    expect(r.decision).toBe('block');
    expect(r.message).toMatch(/Relance niveau 3/);
    const res = await call(ctrl.orderController.create, {
      customerId: ids.held, type: 'custom', pickupDate: '2027-04-10', items: [{ productId: ids.pa, quantity: 1 }],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/Client bloqué/);
  });

  it('prix : grille figée sur la ligne, dérogation réservée à la direction et motivée', async () => {
    const line = [{ productId: ids.pa, quantity: 2, unitPrice: 8 }];
    expect(await ctrl.priceLines(line, null, { role: 'cashier', userId: ids.cashier })).toMatchObject({ error: expect.stringMatching(/réservé à la direction/) });
    expect(await ctrl.priceLines([{ productId: ids.pa, quantity: 1, unitPrice: 5 }], null, { role: 'manager', userId: ids.manager, overrideReason: 'Geste' }))
      .toMatchObject({ error: expect.stringMatching(/50\.0 % du prix grille/) });
    expect(await ctrl.priceLines(line, null, { role: 'manager', userId: ids.manager })).toMatchObject({ error: expect.stringMatching(/motif/) });
    const ok = await ctrl.priceLines(line, null, { role: 'manager', userId: ids.manager, overrideReason: 'Prix négocié' });
    expect('lines' in ok && ok.lines![0]).toMatchObject({ unitPrice: 8, listPrice: 10, overrideBy: ids.manager, overrideReason: 'Prix négocié' });
    // Ligne reprise telle quelle (modification) : pas de nouvelle dérogation, même par la caisse.
    const prior = { [ids.pa]: { unitPrice: 8, listPrice: 10, overrideBy: ids.manager, overrideReason: 'Prix négocié' } };
    const again = await ctrl.priceLines(line, null, { role: 'cashier', userId: ids.cashier, prior });
    expect('lines' in again && again.lines![0]).toMatchObject({ listPrice: 10, overrideBy: ids.manager });
    // Prix grille sans saisie : aucune dérogation.
    const plain = await ctrl.priceLines([{ productId: ids.pa, quantity: 1 }], null, { role: 'cashier', userId: ids.cashier });
    expect('lines' in plain && plain.lines![0]).toMatchObject({ unitPrice: 10, listPrice: 10, overrideBy: null });
  });

  it('remises : plafond par rôle, remise personnel imposée par le serveur', async () => {
    const order = (role: string, extra: Record<string, unknown>) => call(ctrl.orderController.create, {
      customerName: `Passage L3 ${RUN}`, type: 'custom', pickupDate: '2027-04-10', items: [{ productId: ids.pa, quantity: 10 }], ...extra,
    }, role);
    const refused = await order('cashier', { discountPct: 15 });
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toMatch(/au-delà de votre plafond \(10 %\)/);
    expect((await order('cashier', { discountPct: 10 })).status).toBe(201);
    expect((await order('manager', { discountPct: 40 })).status).toBe(400);
    expect((await order('admin', { discountPct: 60 })).status).toBe(201);

    const staff = Number((await p().query(`SELECT staff_discount_percent FROM company_settings LIMIT 1`)).rows[0]?.staff_discount_percent ?? 10) || 10;
    const s = await order('cashier', { type: 'staff', discountPct: 90 });
    expect(s.status).toBe(201);
    expect(Number(s.body.data.discount_pct)).toBe(staff);
  });

  it('commande + avance dans une transaction, canal « commande » repris par le ticket', async () => {
    const sess = (await p().query(`INSERT INTO cash_register_sessions (user_id, store_id, status, opening_amount) VALUES ($1, $2, 'open', 0) RETURNING id`,
      [ids.cashier, fx.storeId])).rows[0].id;
    try {
      const r = await call(ctrl.orderController.create, {
        customerName: `Passage L3 ${RUN}`, type: 'custom', pickupDate: '2027-04-10', paymentMethod: 'cash', advanceAmount: 20,
        items: [{ productId: ids.pa, quantity: 5 }],
      }, 'cashier');
      expect(r.status).toBe(201);
      const row = (await p().query(
        `SELECT sc.code, (SELECT s.channel_id = o.channel_id FROM sales s WHERE s.order_id = o.id AND s.sale_type = 'advance') AS same,
                (SELECT s.total FROM sales s WHERE s.order_id = o.id AND s.sale_type = 'advance')::float8 AS adv
           FROM orders o JOIN sales_channels sc ON sc.id = o.channel_id WHERE o.id = $1`, [r.body.data.id])).rows[0];
      expect(row).toEqual({ code: 'commande', same: true, adv: 20 });
      // Grille figée sur la ligne.
      expect((await p().query(`SELECT list_price::float8 AS lp FROM order_items WHERE order_id = $1`, [r.body.data.id])).rows[0].lp).toBe(10);
    } finally {
      await p().query(`DELETE FROM cash_register_sessions WHERE id = $1`, [sess]).catch(() => undefined);
    }
  });

  it('devis : brouillon non convertible, conversion unique même en concurrence, canal « gros »', async () => {
    const q = await quotes.create({ customerId: ids.expo, withTax: true, items: [{ productId: ids.pa, quantity: 3 }] },
      { userId: fx.userId, storeId: fx.storeId, validityDays: 30 }) as { data?: { id: string }; id?: string };
    const qid = (q.data?.id ?? q.id) as string;
    expect(await quotes.convert(qid, { pickupDate: '2027-04-12', userId: fx.userId, storeId: fx.storeId })).toMatchObject({ error: expect.stringMatching(/brouillon/) });
    await quotes.transition(qid, 'send', { userId: fx.userId });
    const [a, b] = await Promise.all([
      quotes.convert(qid, { pickupDate: '2027-04-12', userId: fx.userId, storeId: fx.storeId }),
      quotes.convert(qid, { pickupDate: '2027-04-12', userId: fx.userId, storeId: fx.storeId }),
    ]);
    const wins = [a, b].filter(r => 'order' in r && r.order);
    expect(wins).toHaveLength(1);
    const code = (await p().query(
      `SELECT sc.code FROM quotes q JOIN orders o ON o.id = q.order_id JOIN sales_channels sc ON sc.id = o.channel_id WHERE q.id = $1`, [qid])).rows[0].code;
    expect(code).toBe('gros');
  });
});
