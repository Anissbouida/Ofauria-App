/**
 * Scenarios VENTES AU MAGASIN (POS) — parcours realistes d'une caissiere.
 *
 * On joue, sur une vraie base migree, les gestes du comptoir :
 *   - encaisser une vente comptant/carte/mixte (FEFO des lots vitrine) ;
 *   - refuser une vente dont tous les lots vitrine sont perimes (DLV / DDE) ;
 *   - refuser une vente sans stock vitrine (INSUFFICIENT_VITRINE_STOCK) ;
 *   - rendre un article (recredit du lot d'origine), avec le cas « lot
 *     d'origine plus actif » (F-037) ;
 *   - echanger un article (recredit du rendu + FEFO du neuf) ;
 *   - fideliser sans double comptage (payee a la creation, impayee a
 *     l'encaissement) ;
 *   - cloturer la journee : fenetre de ventes qui ignore les sessions datees
 *     dans le futur (F-030), invendus non traites (F-032), produits expires
 *     non detruits (EXPIRED_ITEMS_PENDING).
 *
 * Toutes les assertions decrivent le comportement ATTENDU correct. Les vrais
 * ecarts sont marques `// CONSTAT:` et remontes dans le rapport.
 *
 * POS_ALLOW_NEGATIVE_STOCK : ON par defaut en dev, ce qui desactiverait le
 * garde-fou de rupture de stock. On force OFF ici pour jouer le comportement
 * de PRODUCTION (vente refusee si vitrine insuffisante). Pose AVANT tout import
 * dynamique de feature-flags (lu une seule fois a l'import).
 */
process.env.POS_ALLOW_NEGATIVE_STOCK = 'off';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, cleanupFixtures, RUN, type Fixtures, num,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Scenarios VENTES POS — caissiere (comptoir)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let saleRepository: typeof import('../../repositories/sale.repository.js').saleRepository;
  let returnRepository: typeof import('../../repositories/return.repository.js').returnRepository;
  let unsoldDecisionRepository: typeof import('../../repositories/unsold-decision.repository.js').unsoldDecisionRepository;
  let fx: Fixtures;

  const productIds: string[] = [];
  const lotIds: string[] = [];
  const saleIds: string[] = [];
  let customerId: string | null = null;
  const sessionIds: string[] = [];

  // ─── Fabriques de fixtures POS ────────────────────────────────────────────
  const makeProduct = async (slug: string, price: number, saleUnit: 'unit' | 'weight' = 'unit'): Promise<string> => {
    const r = await testPool().query(
      `INSERT INTO products (name, slug, price, sale_type, sale_unit)
       VALUES ($1, $2, $3, 'jour', $4) RETURNING id`,
      [`${slug} ${RUN}`, `${slug}-${RUN}`, price, saleUnit]
    );
    productIds.push(r.rows[0].id);
    return r.rows[0].id;
  };

  const setVitrineStock = async (productId: string, vitrine: number): Promise<void> => {
    await testPool().query(
      `INSERT INTO product_store_stock (product_id, store_id, stock_quantity, stock_min_threshold, vitrine_quantity)
       VALUES ($1, $2, 0, 0, $3)
       ON CONFLICT (product_id, store_id) DO UPDATE SET vitrine_quantity = EXCLUDED.vitrine_quantity`,
      [productId, fx.storeId, vitrine]
    );
  };

  const makeLot = async (productId: string, data: {
    lotTag: string; vitrine: number; backroom?: number; sold?: number;
    expiresInDays?: number | null; displayExpiresHours?: number | null; status?: string;
  }): Promise<string> => {
    const total = data.vitrine + (data.backroom ?? 0) + (data.sold ?? 0);
    const r = await testPool().query(
      `INSERT INTO product_lots
         (product_id, store_id, lot_number, quantity_total, vitrine_qty, backroom_qty, sold_qty,
          produced_at, expires_at, display_expires_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
          NOW(),
          CASE WHEN $8::int IS NULL THEN NULL ELSE (CURRENT_DATE + $8::int) END,
          CASE WHEN $9::numeric IS NULL THEN NULL ELSE (NOW() + ($9::numeric * INTERVAL '1 hour')) END,
          $10)
       RETURNING id`,
      [productId, fx.storeId, `${data.lotTag}-${RUN}`.slice(0, 40), total,
       data.vitrine, data.backroom ?? 0, data.sold ?? 0,
       data.expiresInDays ?? null, data.displayExpiresHours ?? null, data.status ?? 'active']
    );
    lotIds.push(r.rows[0].id);
    return r.rows[0].id;
  };

  /** Vente « d'origine » posee a la main (comme une vente POS passee) + lien lot. */
  const makeOriginalSale = async (
    productId: string, lotId: string, qty: number, unitPrice: number
  ): Promise<{ saleId: string; saleItemId: string }> => {
    const p = testPool();
    const sale = await p.query(
      `INSERT INTO sales (sale_number, user_id, store_id, subtotal, total, payment_method)
       VALUES ($1, $2, $3, $4, $4, 'cash') RETURNING id`,
      [`SC${RUN}${Math.floor(Math.random() * 900 + 100)}`.slice(0, 20), fx.userId, fx.storeId, unitPrice * qty]
    );
    saleIds.push(sale.rows[0].id);
    const si = await p.query(
      `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [sale.rows[0].id, productId, qty, unitPrice, unitPrice * qty]
    );
    await p.query(
      `INSERT INTO sale_item_lots (sale_item_id, product_lot_id, quantity) VALUES ($1, $2, $3)`,
      [si.rows[0].id, lotId, qty]
    );
    return { saleId: sale.rows[0].id, saleItemId: si.rows[0].id };
  };

  const vitrineOf = async (productId: string) =>
    num((await testPool().query(
      `SELECT vitrine_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`,
      [productId, fx.storeId])).rows[0]?.vitrine_quantity);

  const lotState = async (lotId: string) => {
    const r = await testPool().query(`SELECT vitrine_qty, sold_qty FROM product_lots WHERE id = $1`, [lotId]);
    return { vitrine: num(r.rows[0].vitrine_qty), sold: num(r.rows[0].sold_qty) };
  };

  beforeAll(async () => {
    repos = await importRepositories();
    saleRepository = (await import('../../repositories/sale.repository.js')).saleRepository;
    returnRepository = (await import('../../repositories/return.repository.js')).returnRepository;
    unsoldDecisionRepository = (await import('../../repositories/unsold-decision.repository.js')).unsoldDecisionRepository;
    fx = await createBaseFixtures();
  }, 60_000);

  afterAll(async () => {
    const p = testPool();
    const run = async (sql: string, params: unknown[]) => { try { await p.query(sql, params); } catch { /* best effort */ } };
    await run(`DELETE FROM sale_item_lots WHERE product_lot_id = ANY($1::uuid[])`, [lotIds]);
    await run(`DELETE FROM sale_item_lots WHERE sale_item_id IN (SELECT id FROM sale_items WHERE sale_id = ANY($1::uuid[]))`, [saleIds]);
    await run(`DELETE FROM sale_return_items WHERE product_id = ANY($1::uuid[])`, [productIds]);
    await run(`DELETE FROM sale_returns WHERE store_id = $1`, [fx.storeId]);
    await run(`DELETE FROM sale_items WHERE product_id = ANY($1::uuid[])`, [productIds]);
    await run(`DELETE FROM sales WHERE store_id = $1`, [fx.storeId]);
    await run(`DELETE FROM product_lot_movements WHERE product_lot_id = ANY($1::uuid[])`, [lotIds]);
    await run(`DELETE FROM product_stock_transactions WHERE product_id = ANY($1::uuid[])`, [productIds]);
    await run(`DELETE FROM product_lots WHERE product_id = ANY($1::uuid[])`, [productIds]);
    await run(`DELETE FROM product_store_stock WHERE product_id = ANY($1::uuid[])`, [productIds]);
    await run(`DELETE FROM unsold_decisions WHERE store_id = $1`, [fx.storeId]);
    await run(`DELETE FROM cash_register_sessions WHERE id = ANY($1::uuid[])`, [sessionIds]);
    await run(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [productIds]);
    if (customerId) await run(`DELETE FROM customers WHERE id = $1`, [customerId]);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  // ───────────────────────────────────────────────────────────────────────
  // 1. Vente comptant : FEFO multi-lots + sale_item_lots + vitrine decrementee
  // ───────────────────────────────────────────────────────────────────────
  it('vente comptant : consomme les lots en FEFO et decremente la vitrine', async () => {
    const prod = await makeProduct('vente-comptant', 5);
    await setVitrineStock(prod, 8);
    // Lot A proche (demain), lot B plus loin (+5 j). FEFO doit vider A avant B.
    const lotA = await makeLot(prod, { lotTag: 'LA', vitrine: 3, expiresInDays: 1 });
    const lotB = await makeLot(prod, { lotTag: 'LB', vitrine: 5, expiresInDays: 5 });

    const sale = await saleRepository.create({
      userId: fx.userId, storeId: fx.storeId,
      subtotal: 20, taxAmount: 0, discountAmount: 0, total: 20,
      paymentMethod: 'cash',
      items: [{ productId: prod, quantity: 4, unitPrice: 5, subtotal: 20 }],
    });
    saleIds.push(sale.id);

    expect(sale.payment_method).toBe('cash');
    expect(await vitrineOf(prod)).toBeCloseTo(4, 3);          // 8 - 4
    const a = await lotState(lotA);
    const b = await lotState(lotB);
    expect(a).toEqual({ vitrine: 0, sold: 3 });               // A vide en premier (FEFO)
    expect(b).toEqual({ vitrine: 4, sold: 1 });               // reliquat sur B

    // Tracabilite descendante : sale_item_lots pose pour les 2 lots servis.
    const links = await testPool().query(
      `SELECT sil.product_lot_id, sil.quantity
         FROM sale_item_lots sil
         JOIN sale_items si ON si.id = sil.sale_item_id
        WHERE si.sale_id = $1 ORDER BY sil.quantity DESC`,
      [sale.id]
    );
    expect(links.rows).toHaveLength(2);
    expect(num(links.rows[0].quantity)).toBe(3);
    expect(num(links.rows[1].quantity)).toBe(1);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 2. Vente carte : mode de paiement persiste, stock decremente pareil
  // ───────────────────────────────────────────────────────────────────────
  it('vente carte : enregistre payment_method=card et decremente la vitrine', async () => {
    const prod = await makeProduct('vente-carte', 10);
    await setVitrineStock(prod, 2);
    await makeLot(prod, { lotTag: 'LC', vitrine: 2, expiresInDays: 2 });

    const sale = await saleRepository.create({
      userId: fx.userId, storeId: fx.storeId,
      subtotal: 10, taxAmount: 0, discountAmount: 0, total: 10,
      paymentMethod: 'card',
      items: [{ productId: prod, quantity: 1, unitPrice: 10, subtotal: 10 }],
    });
    saleIds.push(sale.id);

    expect(sale.payment_method).toBe('card');
    expect(await vitrineOf(prod)).toBeCloseTo(1, 3);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 3. Vente mixte (especes + carte) : ventilation persistee (mig 250)
  // ───────────────────────────────────────────────────────────────────────
  it('vente mixte : cash_amount + card_amount persistes et coherents avec le total', async () => {
    const prod = await makeProduct('vente-mixte', 10);
    await setVitrineStock(prod, 3);
    await makeLot(prod, { lotTag: 'LM', vitrine: 3, expiresInDays: 2 });

    const sale = await saleRepository.create({
      userId: fx.userId, storeId: fx.storeId,
      subtotal: 30, taxAmount: 0, discountAmount: 0, total: 30,
      paymentMethod: 'mixed', cashAmount: 20, cardAmount: 10,
      items: [{ productId: prod, quantity: 3, unitPrice: 10, subtotal: 30 }],
    });
    saleIds.push(sale.id);

    expect(sale.payment_method).toBe('mixed');
    expect(num(sale.cash_amount) + num(sale.card_amount)).toBeCloseTo(num(sale.total), 2);
    expect(num(sale.cash_amount)).toBeCloseTo(20, 2);
    expect(num(sale.card_amount)).toBeCloseTo(10, 2);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 4. Securite alimentaire : vente refusee si DLV depassee sur tous les lots
  // ───────────────────────────────────────────────────────────────────────
  it('vente refusee (DLV_EXPIREE) quand le seul lot vitrine a sa date limite de vente atteinte', async () => {
    const prod = await makeProduct('dlv-expiree', 5);
    await setVitrineStock(prod, 4);
    // expires_at = aujourd'hui (<= CURRENT_DATE) => DLV atteinte, aucun lot valide.
    await makeLot(prod, { lotTag: 'LDLV', vitrine: 4, expiresInDays: 0 });

    let caught: (Error & { code?: string; statusCode?: number }) | null = null;
    try {
      await saleRepository.create({
        userId: fx.userId, storeId: fx.storeId,
        subtotal: 5, taxAmount: 0, discountAmount: 0, total: 5,
        paymentMethod: 'cash',
        items: [{ productId: prod, quantity: 1, unitPrice: 5, subtotal: 5 }],
      });
    } catch (e) { caught = e as Error & { code?: string }; }

    expect(caught).not.toBeNull();
    expect(caught!.code).toBe('DLV_EXPIREE');
    expect(caught!.statusCode).toBe(409);
    // Transaction annulee : la vitrine n'a pas bouge.
    expect(await vitrineOf(prod)).toBeCloseTo(4, 3);
    const noSale = await testPool().query(
      `SELECT COUNT(*)::int AS n FROM sale_items WHERE product_id = $1`, [prod]);
    expect(noSale.rows[0].n).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 5. Securite alimentaire : vente refusee si DDE (duree d'exposition) depassee
  // ───────────────────────────────────────────────────────────────────────
  it('vente refusee (DDE_EXPIREE) quand la duree d\'exposition vitrine est depassee', async () => {
    const prod = await makeProduct('dde-expiree', 5);
    await setVitrineStock(prod, 4);
    // DLV future (+3 j) mais display_expires_at dans le passe => DDE atteinte.
    await makeLot(prod, { lotTag: 'LDDE', vitrine: 4, expiresInDays: 3, displayExpiresHours: -2 });

    let caught: (Error & { code?: string }) | null = null;
    try {
      await saleRepository.create({
        userId: fx.userId, storeId: fx.storeId,
        subtotal: 5, taxAmount: 0, discountAmount: 0, total: 5,
        paymentMethod: 'cash',
        items: [{ productId: prod, quantity: 1, unitPrice: 5, subtotal: 5 }],
      });
    } catch (e) { caught = e as Error & { code?: string }; }

    expect(caught).not.toBeNull();
    expect(caught!.code).toBe('DDE_EXPIREE');
    expect(await vitrineOf(prod)).toBeCloseTo(4, 3);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 6. Rupture : vente refusee s'il n'y a rien en vitrine (prod OFF negative)
  // ───────────────────────────────────────────────────────────────────────
  it('vente refusee (INSUFFICIENT_VITRINE_STOCK) quand la vitrine est vide', async () => {
    const prod = await makeProduct('rupture', 5);
    await setVitrineStock(prod, 0);   // rien en vitrine, aucun lot

    let caught: (Error & { code?: string; statusCode?: number }) | null = null;
    try {
      await saleRepository.create({
        userId: fx.userId, storeId: fx.storeId,
        subtotal: 5, taxAmount: 0, discountAmount: 0, total: 5,
        paymentMethod: 'cash',
        items: [{ productId: prod, quantity: 1, unitPrice: 5, subtotal: 5 }],
      });
    } catch (e) { caught = e as Error & { code?: string; statusCode?: number }; }

    expect(caught).not.toBeNull();
    expect(caught!.code).toBe('INSUFFICIENT_VITRINE_STOCK');
    expect(caught!.statusCode).toBe(409);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 7. Retour : recredite le lot d'origine, vitrine et lot restent en phase
  // ───────────────────────────────────────────────────────────────────────
  it('retour : l\'article revient sur son lot d\'origine (sold -> vitrine)', async () => {
    const prod = await makeProduct('retour-ok', 6);
    await setVitrineStock(prod, 4);
    const lot = await makeLot(prod, { lotTag: 'LR', vitrine: 4, sold: 1, expiresInDays: 2 });
    const { saleId, saleItemId } = await makeOriginalSale(prod, lot, 1, 6);

    await returnRepository.create({
      originalSaleId: saleId, userId: fx.userId, storeId: fx.storeId,
      type: 'return', refundAmount: 6,
      items: [{ saleItemId, productId: prod, quantity: 1, unitPrice: 6, subtotal: 6 }],
    });

    expect(await vitrineOf(prod)).toBeCloseTo(5, 3);          // 4 + 1 rendu
    expect(await lotState(lot)).toEqual({ vitrine: 5, sold: 0 });
  });

  // ───────────────────────────────────────────────────────────────────────
  // 8. Retour F-037 : lot d'origine plus actif -> rien remis en rayon
  // ───────────────────────────────────────────────────────────────────────
  it('retour : si le lot d\'origine n\'est plus actif, l\'article n\'est pas reexpose', async () => {
    const prod = await makeProduct('retour-lot-inactif', 6);
    await setVitrineStock(prod, 2);
    // Lot d'origine desormais 'expired' : le rendu ne doit pas revenir en rayon.
    const lot = await makeLot(prod, { lotTag: 'LRI', vitrine: 0, sold: 1, expiresInDays: 0, status: 'expired' });
    const { saleId, saleItemId } = await makeOriginalSale(prod, lot, 1, 6);

    const ret = await returnRepository.create({
      originalSaleId: saleId, userId: fx.userId, storeId: fx.storeId,
      type: 'return', refundAmount: 6,
      items: [{ saleItemId, productId: prod, quantity: 1, unitPrice: 6, subtotal: 6 }],
    });

    // Vitrine inchangee (lot perime, invendable), lot non recredite.
    expect(await vitrineOf(prod)).toBeCloseTo(2, 3);
    expect(await lotState(lot)).toEqual({ vitrine: 0, sold: 1 });
    // La transaction de stock trace 0 remis en rayon avec la note explicite.
    const tx = await testPool().query(
      `SELECT quantity_change, note FROM product_stock_transactions
        WHERE reference_id = $1 AND type = 'return'`,
      [ret.id]
    );
    expect(tx.rows).toHaveLength(1);
    expect(num(tx.rows[0].quantity_change)).toBe(0);
    expect(String(tx.rows[0].note)).toMatch(/remis en rayon/i);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 9. Echange : recredite le rendu + decremente un lot FEFO du neuf
  // ───────────────────────────────────────────────────────────────────────
  it('echange : le produit rendu revient en rayon, le neuf sort en FEFO', async () => {
    const rendu = await makeProduct('ech-rendu', 6);
    await setVitrineStock(rendu, 2);
    const lotRendu = await makeLot(rendu, { lotTag: 'LER', vitrine: 2, sold: 1, expiresInDays: 2 });
    const { saleId, saleItemId } = await makeOriginalSale(rendu, lotRendu, 1, 6);

    const neuf = await makeProduct('ech-neuf', 6);
    await setVitrineStock(neuf, 3);
    const lotNeuf = await makeLot(neuf, { lotTag: 'LEN', vitrine: 3, expiresInDays: 4 });

    await returnRepository.create({
      originalSaleId: saleId, userId: fx.userId, storeId: fx.storeId,
      type: 'exchange', refundAmount: 6,
      items: [{ saleItemId, productId: rendu, quantity: 1, unitPrice: 6, subtotal: 6 }],
      exchangeProducts: [{ saleItemId, newProductId: neuf, quantity: 1 }],
    });

    expect(await vitrineOf(rendu)).toBeCloseTo(3, 3);         // 2 + 1 rendu
    expect((await lotState(lotRendu)).vitrine).toBeCloseTo(3, 3);
    expect(await vitrineOf(neuf)).toBeCloseTo(2, 3);          // 3 - 1 neuf
    expect((await lotState(lotNeuf)).vitrine).toBeCloseTo(2, 3);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 10. Fidelite : pas de double comptage (payee a la creation, impayee au pay)
  // ───────────────────────────────────────────────────────────────────────
  it('fidelite : points comptes une seule fois (vente payee a la creation, impayee a l\'encaissement)', async () => {
    const cust = await testPool().query(
      `INSERT INTO customers (first_name, last_name, loyalty_points, total_spent)
       VALUES ('Fidele', $1, 0, 0) RETURNING id`, [RUN]
    );
    customerId = cust.rows[0].id;

    const prod = await makeProduct('fidelite', 5);
    await setVitrineStock(prod, 10);
    await makeLot(prod, { lotTag: 'LF', vitrine: 10, expiresInDays: 3 });

    const pointsOf = async () =>
      num((await testPool().query(`SELECT loyalty_points FROM customers WHERE id = $1`, [customerId])).rows[0].loyalty_points);

    // Vente payee de 20 DH -> +20 points une fois, a la creation.
    const paid = await saleRepository.create({
      customerId: customerId!, userId: fx.userId, storeId: fx.storeId,
      subtotal: 20, taxAmount: 0, discountAmount: 0, total: 20,
      paymentMethod: 'cash', paymentStatus: 'paid',
      items: [{ productId: prod, quantity: 4, unitPrice: 5, subtotal: 20 }],
    });
    saleIds.push(paid.id);
    expect(await pointsOf()).toBe(20);

    // Vente impayee de 15 DH -> 0 point tant qu'elle n'est pas encaissee.
    const unpaid = await saleRepository.create({
      customerId: customerId!, userId: fx.userId, storeId: fx.storeId,
      subtotal: 15, taxAmount: 0, discountAmount: 0, total: 15,
      paymentMethod: 'credit', paymentStatus: 'unpaid',
      items: [{ productId: prod, quantity: 3, unitPrice: 5, subtotal: 15 }],
    });
    saleIds.push(unpaid.id);
    expect(await pointsOf()).toBe(20);                        // inchange : pas de double comptage

    // Encaissement differe -> +15 points, une seule fois.
    const res = await saleRepository.markPaid(unpaid.id, { paymentMethod: 'cash', sessionId: null });
    expect(res.ok).toBe(true);
    expect(await pointsOf()).toBe(35);                        // 20 + 15, jamais 20 + 15 + 15
  });

  // ───────────────────────────────────────────────────────────────────────
  // 11. Cloture F-030 : la fenetre de ventes ignore les sessions futures
  // ───────────────────────────────────────────────────────────────────────
  it('cloture : une session fermee dans le futur ne masque pas les ventes du jour (F-030)', async () => {
    const prod = await makeProduct('f030', 5);
    // Session FERMEE dans le futur (+30 j) : ne doit pas devenir le debut de fenetre.
    const sess = await testPool().query(
      `INSERT INTO cash_register_sessions (user_id, store_id, status, opening_amount, closed_at)
       VALUES ($1, $2, 'closed', 0, NOW() + INTERVAL '30 days') RETURNING id`,
      [fx.userId, fx.storeId]
    );
    sessionIds.push(sess.rows[0].id);
    const sale = await testPool().query(
      `INSERT INTO sales (sale_number, user_id, store_id, subtotal, total, payment_method)
       VALUES ($1, $2, $3, 10, 10, 'cash') RETURNING id`,
      [`F30${RUN}`.slice(0, 20), fx.userId, fx.storeId]
    );
    saleIds.push(sale.rows[0].id);
    await testPool().query(
      `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES ($1, $2, 2, 5, 10)`,
      [sale.rows[0].id, prod]
    );

    const rows = await unsoldDecisionRepository.getUnsoldWithSuggestions(fx.storeId);
    const mine = rows.find((r: Record<string, unknown>) => r.product_id === prod);
    expect(mine).toBeDefined();
    expect(num(mine!.sold_qty)).toBe(2);                     // 0 avant le fix (fenetre masquee)
  });

  // ───────────────────────────────────────────────────────────────────────
  // 12. Cloture : produits expires non detruits -> getExpiredItems (409 pending)
  // ───────────────────────────────────────────────────────────────────────
  it('cloture : un produit vitrine avec DLC depassee est remonte pour destruction', async () => {
    const prod = await makeProduct('expire-close', 5);
    await setVitrineStock(prod, 3);
    await makeLot(prod, { lotTag: 'LEX', vitrine: 3, expiresInDays: 0 });  // DLC atteinte

    const expired = await unsoldDecisionRepository.getExpiredItems(fx.storeId);
    const mine = expired.find((r: Record<string, unknown>) => r.product_id === prod);
    expect(mine).toBeDefined();
    expect(num(mine!.vitrine_qty)).toBeCloseTo(3, 3);
    expect(String(mine!.expiry_reason)).toBe('dlc_expiree');
    // Le controleur cloture renvoie 409 EXPIRED_ITEMS_PENDING tant que expired.length > 0.
    expect(expired.length).toBeGreaterThan(0);
  });

  // ───────────────────────────────────────────────────────────────────────
  // 13. Cloture F-032 : stock vitrine present + aucune decision -> bloquee
  // ───────────────────────────────────────────────────────────────────────
  it('cloture : stock vitrine present sans decision d\'invendus bloque la fermeture (F-032)', async () => {
    const prod = await makeProduct('f032', 3);
    await setVitrineStock(prod, 10);
    const sess = await testPool().query(
      `INSERT INTO cash_register_sessions (user_id, store_id, status) VALUES ($1, $2, 'open') RETURNING id`,
      [fx.userId, fx.storeId]
    );
    sessionIds.push(sess.rows[0].id);

    const before = await unsoldDecisionRepository.vitrineRemainingAndDecisions(sess.rows[0].id, fx.storeId);
    expect(before.vitrineRemaining).toBeGreaterThanOrEqual(10);
    expect(before.decisionsCount).toBe(0);
    // => controleur : vitrineRemaining > 0 && decisionsCount === 0 -> 409 UNSOLD_DECISIONS_PENDING.
    expect(before.vitrineRemaining > 0 && before.decisionsCount === 0).toBe(true);

    await testPool().query(
      `INSERT INTO unsold_decisions
         (store_id, session_id, product_id, product_name, initial_qty, sold_qty, remaining_qty,
          discrepancy, suggested_destination, final_destination, decided_by)
       VALUES ($1, $2, $3, 'f032', 10, 0, 10, 0, 'reexpose', 'reexpose', $4)`,
      [fx.storeId, sess.rows[0].id, prod, fx.userId]
    );
    const after = await unsoldDecisionRepository.vitrineRemainingAndDecisions(sess.rows[0].id, fx.storeId);
    expect(after.decisionsCount).toBe(1);
    expect(after.vitrineRemaining > 0 && after.decisionsCount === 0).toBe(false);  // cloture autorisee
  });
});
