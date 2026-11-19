/**
 * Parcours PILOTE — enchaînements métier de bout en bout, chiffrés à la main.
 *
 * But : prouver, avant le pilote, que les chiffres s'enchaînent d'un module à l'autre
 * (achat → stock → production → caisse → clôture → inventaire → trésorerie → paie).
 * Chaque assertion porte en commentaire le calcul attendu, fait à la main à partir
 * des règles DU CODE (pas de supposition) :
 *   1. Achat → Réception → Production → Caisse
 *   2. Vente → Caisse : annulation, clôture, nouvelle session (pas de réouverture)
 *   3. Inventaire → Valorisation (stock_counts + fn_stock_at)
 *   4. Dépense fournisseur → Trésorerie (grand livre 5141 + prévision)
 *   5. Paie → Bulletin mensuel (brut, cotisations, IR, net ; aucune écriture)
 *
 * Les écarts au comportement métier attendu ne sont PAS masqués : l'assertion
 * attendue est écrite et marquée `it.fails` avec un commentaire « CONSTAT ».
 *
 * POS_ALLOW_NEGATIVE_STOCK forcé OFF (comportement de production), posé avant tout
 * import dynamique. DLC à J+5 au moins (piège du fuseau en soirée, cf. scenarios-ventes).
 *
 * Isolation : un magasin et un utilisateur propres au fichier (suffixe RUN), nettoyés en
 * afterAll. Les écritures comptables (journal chaîné, suppression interdite par trigger)
 * restent en base, comme pour les autres suites qui vendent ou paient.
 */
process.env.POS_ALLOW_NEGATIVE_STOCK = 'off';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, createProductWithRecipe, cleanupFixtures,
  RUN, num, type Fixtures,
} from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Date locale (Casablanca) décalée de n jours, AAAA-MM-JJ. */
const localDay = (n = 0) => new Date(Date.now() + n * 86400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Casablanca' });

describe.skipIf(!hasTestDb)('Parcours pilote — chiffres de bout en bout', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fx: Fixtures;
  const p = () => testPool();

  // Dépôts et services (importés après la pose de l'environnement).
  let poRepo: any; let saleRepo: any; let cashRepo: any; let stockCountRepo: any; let stockValRepo: any;
  let invoiceRepo: any; let paymentRepo: any; let orderTypeRepo: any; let coutRepo: any; let productLotRepo: any;
  let stockHelper: any; let payrollCfg: any; let cashForecast: any;

  // Traces pour le nettoyage.
  const supplierIds: string[] = [];
  const poIds: string[] = [];
  const orderTypeIds: string[] = [];
  const sessionIds: string[] = [];
  const countIds: string[] = [];
  const invoiceIds: string[] = [];
  const paymentIds: string[] = [];
  const employeeIds: string[] = [];

  beforeAll(async () => {
    repos = await importRepositories();
    poRepo = (await import('../../repositories/purchase-order.repository.js')).purchaseOrderRepository;
    saleRepo = (await import('../../repositories/sale.repository.js')).saleRepository;
    cashRepo = (await import('../../repositories/cash-register.repository.js')).cashRegisterRepository;
    stockCountRepo = (await import('../../repositories/stock-count.repository.js')).stockCountRepository;
    stockValRepo = (await import('../../repositories/stock-valuation.repository.js')).stockValuationRepository;
    const acc = await import('../../repositories/accounting.repository.js');
    invoiceRepo = acc.invoiceRepository; paymentRepo = acc.paymentRepository;
    orderTypeRepo = (await import('../../repositories/production-order-type.repository.js')).productionOrderTypeRepository;
    coutRepo = (await import('../../repositories/production-cout.repository.js')).productionCoutRepository;
    productLotRepo = (await import('../../repositories/product-lot.repository.js')).productLotRepository;
    stockHelper = await import('../../repositories/product-stock.helper.js');
    payrollCfg = await import('../../repositories/payroll-config.repository.js');
    cashForecast = await import('../../services/cash-forecast.js');
    fx = await createBaseFixtures();
  }, 60_000);

  afterAll(async () => {
    const run = async (sql: string, params: unknown[]) => { try { await p().query(sql, params); } catch { /* best effort */ } };
    // ─── Ventes / caisse ───
    await run(`DELETE FROM sale_item_lots WHERE sale_item_id IN (SELECT si.id FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.store_id = $1)`, [fx.storeId]);
    await run(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE store_id = $1)`, [fx.storeId]);
    await run(`DELETE FROM sales WHERE store_id = $1`, [fx.storeId]);
    await run(`DELETE FROM cash_register_sessions WHERE id = ANY($1::uuid[])`, [sessionIds]);
    await run(`DELETE FROM product_lot_movements WHERE product_lot_id IN (SELECT id FROM product_lots WHERE store_id = $1)`, [fx.storeId]);
    // ─── Production ───
    await run(`DELETE FROM production_cout_reel WHERE plan_id = ANY($1::uuid[])`, [fx.ids.plans]);
    // ─── Inventaire ───
    await run(`DELETE FROM stock_count_lines WHERE count_id = ANY($1::uuid[])`, [countIds]);
    await run(`DELETE FROM stock_counts WHERE id = ANY($1::uuid[])`, [countIds]);
    // ─── Achats (BC, réceptions, factures auto) ───
    await run(`DELETE FROM ledger_outbox WHERE source_id IN (SELECT rvi.id FROM reception_voucher_items rvi JOIN reception_vouchers rv ON rv.id = rvi.reception_voucher_id WHERE rv.purchase_order_id = ANY($1))`, [poIds]);
    await run(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE purchase_order_id = ANY($1))`, [poIds]);
    await run(`DELETE FROM invoice_purchase_orders WHERE purchase_order_id = ANY($1)`, [poIds]);
    await run(`DELETE FROM invoices WHERE purchase_order_id = ANY($1)`, [poIds]);
    await run(`DELETE FROM inventory_transactions WHERE reception_voucher_id IN (SELECT id FROM reception_vouchers WHERE purchase_order_id = ANY($1))`, [poIds]);
    await run(`DELETE FROM production_lot_usage WHERE ingredient_id = ANY($1::uuid[])`, [fx.ids.ingredients]);
    await run(`DELETE FROM ingredient_lots WHERE reception_voucher_item_id IN (SELECT rvi.id FROM reception_voucher_items rvi JOIN reception_vouchers rv ON rv.id = rvi.reception_voucher_id WHERE rv.purchase_order_id = ANY($1))`, [poIds]);
    await run(`DELETE FROM reception_voucher_items WHERE reception_voucher_id IN (SELECT id FROM reception_vouchers WHERE purchase_order_id = ANY($1))`, [poIds]);
    await run(`DELETE FROM reception_vouchers WHERE purchase_order_id = ANY($1)`, [poIds]);
    await run(`DELETE FROM po_line_events WHERE po_line_id IN (SELECT id FROM purchase_order_items WHERE purchase_order_id = ANY($1))`, [poIds]);
    await run(`DELETE FROM purchase_order_versions WHERE purchase_order_id = ANY($1)`, [poIds]);
    await run(`DELETE FROM purchase_order_items WHERE purchase_order_id = ANY($1)`, [poIds]);
    await run(`DELETE FROM document_actions WHERE document_id = ANY($1)`, [poIds]);
    await run(`DELETE FROM purchase_orders WHERE id = ANY($1)`, [poIds]);
    // ─── Trésorerie : un paiement exécuté ne se supprime qu'avec app.payment_purge ───
    {
      const c = await p().connect();
      try {
        await c.query('BEGIN');
        await c.query(`SELECT set_config('app.payment_purge', 'on', true)`);
        await c.query(`DELETE FROM payments WHERE id = ANY($1::uuid[])`, [paymentIds]);
        await c.query('COMMIT');
      } catch { await c.query('ROLLBACK').catch(() => undefined); } finally { c.release(); }
    }
    await run(`DELETE FROM invoice_holds WHERE invoice_id = ANY($1::uuid[])`, [invoiceIds]);
    await run(`DELETE FROM invoices WHERE id = ANY($1::uuid[])`, [invoiceIds]);
    // ─── Paie ───
    await run(`DELETE FROM payroll_lines WHERE payroll_id IN (SELECT id FROM payroll WHERE employee_id = ANY($1::uuid[]))`, [employeeIds]);
    await run(`DELETE FROM payroll WHERE employee_id = ANY($1::uuid[])`, [employeeIds]);
    await run(`DELETE FROM attendance WHERE employee_id = ANY($1::uuid[])`, [employeeIds]);
    await run(`DELETE FROM employees WHERE id = ANY($1::uuid[])`, [employeeIds]);
    // ─── Référentiels ───
    for (const t of orderTypeIds) await orderTypeRepo?.update(t, { isActive: false }, fx.userId).catch(() => undefined);
    await run(`DELETE FROM suppliers WHERE id = ANY($1::uuid[])`, [supplierIds]);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  }, 120_000);

  // ─── Utilitaires partagés ───
  const newSupplier = async (label: string) => {
    const id = (await p().query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`${label} ${RUN}`])).rows[0].id as string;
    supplierIds.push(id);
    return id;
  };
  const vitrineOf = async (productId: string) => num((await p().query(
    `SELECT vitrine_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`, [productId, fx.storeId])).rows[0]?.vitrine_quantity);
  const backroomOf = async (productId: string) => num((await p().query(
    `SELECT stock_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`, [productId, fx.storeId])).rows[0]?.stock_quantity);
  const ingredientStockOf = async (ingredientId: string) => num((await p().query(
    `SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [ingredientId, fx.storeId])).rows[0]?.current_quantity);

  // ════════════════════════════════════════════════════════════════════════════
  // 1. ACHAT → RÉCEPTION → PRODUCTION → CAISSE
  // ════════════════════════════════════════════════════════════════════════════
  describe('1. Achat → Réception → Production → Caisse', () => {
    let farineId: string; let supplierId: string;
    let productId: string; let planId: string; let planItemId: string; let orderTypeId: string;
    let lotAId: string; let lotBId: string; let productLotId: string;
    let saleId: string;

    const receive = async (qty: number, price: number, dlcDays: number) => {
      const po = await poRepo.create({ supplierId, createdBy: fx.userId, storeId: fx.storeId,
        items: [{ ingredientId: farineId, quantityOrdered: qty, unitPrice: price }] });
      poIds.push(po.id);
      await poRepo.updateStatus(po.id, 'envoye');
      const itemId = (await poRepo.findById(po.id))!.items[0].id as string;
      const r = await poRepo.confirmDelivery(po.id, [{ itemId, quantityDelivered: qty, expirationDate: localDay(dlcDays) }], fx.userId, fx.storeId);
      expect(r.status).toBe('livre_complet');
      const lot = await p().query(
        `SELECT il.id FROM ingredient_lots il JOIN reception_voucher_items rvi ON rvi.id = il.reception_voucher_item_id
           JOIN reception_vouchers rv ON rv.id = rvi.reception_voucher_id WHERE rv.purchase_order_id = $1`, [po.id]);
      return lot.rows[0].id as string;
    };

    beforeAll(async () => {
      // Coût fiche volontairement faux (99) : la 1re réception le remplace par le prix reçu.
      farineId = await createIngredient(fx, { name: 'Farine P1', unit: 'kg', unitCost: 99 });
      supplierId = await newSupplier('Minoterie P1');
      productId = (await createProductWithRecipe(fx, {
        name: 'Pain P1', price: 3, shelfLifeDays: 5,           // DLC J+5 (hors piège du soir)
        ingredients: [{ ingredientId: farineId, quantity: 0.5, unit: 'kg' }],   // 0,5 kg / pain
      })).productId;
      // Type d'ordre « consommation à la déclaration », sans bon de sortie ni pesée (M6-01).
      const code = `P1DECL_${RUN}`.slice(0, 30).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      orderTypeId = (await orderTypeRepo.create({ code, label: `Déclaration P1 ${RUN}`, requiresBonSortie: false, requiresWeighing: false, consumptionMode: 'a_la_declaration' }, fx.userId)).id;
      orderTypeIds.push(orderTypeId);
    }, 60_000);

    it('réception de 2 BC : 25 kg à 8 DH puis 25 kg à 10 DH → CMUP 9, stock 50 kg sur 2 lots', async () => {
      lotAId = await receive(25, 8, 30);    // lot A : DLC J+30 (sortira en premier, FEFO)
      // 1re réception sur stock vide → coût fiche = prix reçu = 8
      expect(num((await p().query(`SELECT unit_cost FROM ingredients WHERE id = $1`, [farineId])).rows[0].unit_cost)).toBeCloseTo(8, 4);
      lotBId = await receive(25, 10, 60);   // lot B : DLC J+60
      // CMUP = (25 × 8 + 25 × 10) / 50 = 450 / 50 = 9
      expect(num((await p().query(`SELECT unit_cost FROM ingredients WHERE id = $1`, [farineId])).rows[0].unit_cost)).toBeCloseTo(9, 4);
      // Stock = 25 + 25 = 50 kg (inventaire synchronisé par les lots)
      expect(await ingredientStockOf(farineId)).toBeCloseTo(50, 3);
      const lots = await p().query(`SELECT id, unit_cost FROM ingredient_lots WHERE id = ANY($1::uuid[]) ORDER BY unit_cost`, [[lotAId, lotBId]]);
      // Chaque lot garde son prix d'achat : A = 8, B = 10
      expect(lots.rows.map(r => num(r.unit_cost))).toEqual([8, 10]);
    });

    it('production de 10 pains (consommation à la déclaration) : 5 kg sortis du lot A (FEFO), lot produit de 10', async () => {
      const plan = await repos.productionRepository.create({
        planDate: localDay(0), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
        items: [{ productId, plannedQuantity: 10 }], orderTypeId, priority: 1,
      } as any);
      planId = plan.id; fx.ids.plans.push(planId);
      planItemId = (await p().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [planId])).rows[0].id;
      await repos.productionRepository.confirm(planId, fx.userId);
      await repos.productionRepository.start(planId, fx.userId);
      const res = await repos.productionRepository.produceItems(planId, [{ planItemId, actualQuantity: 10 }], fx.userId, fx.storeId);
      expect(res.autoCompleted).toBe(true);

      // Besoin = 10 pains × 0,5 kg = 5 kg ; stock matière = 50 − 5 = 45 kg
      expect(await ingredientStockOf(farineId)).toBeCloseTo(45, 3);
      // FEFO : tout sort du lot A (DLC la plus proche) → A = 25 − 5 = 20 kg, B intact = 25 kg
      const lots = await p().query(`SELECT id, (economat_quantity + pesage_quantity)::float8 AS q FROM ingredient_lots WHERE id = ANY($1::uuid[])`, [[lotAId, lotBId]]);
      const qty = Object.fromEntries(lots.rows.map(r => [r.id, num(r.q)]));
      expect(qty[lotAId]).toBeCloseTo(20, 3);
      expect(qty[lotBId]).toBeCloseTo(25, 3);
      // Traçabilité : 5 kg consommés au coût du lot A (8 DH)
      const usage = await p().query(`SELECT SUM(quantity_used)::float8 AS q, MAX(unit_cost_at_use)::float8 AS c, MAX(ingredient_lot_id::text) AS lot FROM production_lot_usage WHERE production_plan_id = $1`, [planId]);
      expect(num(usage.rows[0].q)).toBeCloseTo(5, 3);
      expect(usage.rows[0].lot).toBe(lotAId);
      expect(num(usage.rows[0].c)).toBeCloseTo(8, 4);

      // Lot produit fini : 10 pains en réserve, DLC = jour de production + 5 j
      const pl = await p().query(
        `SELECT id, quantity_total, backroom_qty, unit_cost, expires_at::text AS exp,
                ((produced_at AT TIME ZONE 'Africa/Casablanca')::date + 5)::text AS expected_exp
           FROM product_lots WHERE production_plan_id = $1`, [planId]);
      expect(pl.rows).toHaveLength(1);
      productLotId = pl.rows[0].id;
      expect(num(pl.rows[0].quantity_total)).toBeCloseTo(10, 3);
      expect(num(pl.rows[0].backroom_qty)).toBeCloseTo(10, 3);
      expect(pl.rows[0].exp).toBe(pl.rows[0].expected_exp);
      // Coût du lot à la déclaration (pas encore de coût réel) = coût standard de la fiche
      // au CMUP : 0,5 kg × 9 DH = 4,50 DH / pain (trigger trg_lot_cost_fill, mig 452)
      expect(num(pl.rows[0].unit_cost)).toBeCloseTo(4.5, 4);
      // Stock produit (réserve) = 10
      expect(await backroomOf(productId)).toBeCloseTo(10, 3);
    });

    it('coût réel du plan : matières au FIFO du lot = 5 kg × 8 DH = 40 DH, figé sur le lot produit', async () => {
      const cr = await coutRepo.calculateAndSave(planId, fx.userId);
      // Matières réelles = 5 kg × 8 DH (lot A) = 40,00 DH
      expect(num(cr.cout_matieres)).toBeCloseTo(40, 2);
      // Pas de MO / énergie / emballage saisis sur ce plan
      expect(num(cr.cout_main_oeuvre)).toBeCloseTo(0, 2);
      expect(num(cr.cout_energie)).toBeCloseTo(0, 2);
      // Charges fixes = taux paramétré × 40 (politique production.fixed_charges_rate)
      const rate = (await coutRepo.chargesSettings(planId)).rate as number;
      expect(num(cr.cout_charges_fixes)).toBeCloseTo(Math.round(40 * rate * 100) / 100, 2);
      // Coût unitaire du lot = coût total / 10 pains = (40 + 40 × taux) / 10
      const expectedUnit = Math.round((40 + Math.round(40 * rate * 100) / 100) / 10 * 10000) / 10000;
      const pl = await p().query(`SELECT unit_cost FROM product_lots WHERE id = $1`, [productLotId]);
      expect(num(pl.rows[0].unit_cost)).toBeCloseTo(expectedUnit, 4);
    });

    it('mise en vitrine de 6 pains puis vente de 4 à 3 DH : 12 DH encaissés, stock 6 (2 vitrine + 4 réserve)', async () => {
      // Mise en vitrine : mêmes fonctions que la réception d'approvisionnement (replenishment).
      const client = await repos.db.getClient();
      try {
        await client.query('BEGIN');
        const moved = await stockHelper.transferBackroomToVitrine(client, productId, fx.storeId, 6);
        expect(moved).toBe(6);
        const plan = await productLotRepo.planFefoBackroomConsumption(client, productId, fx.storeId, moved);
        for (const step of plan) await productLotRepo.transferBackroomToVitrine(client, step.lotId, step.qty, null);
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
      // Réserve 10 − 6 = 4 ; vitrine 0 + 6 = 6
      expect(await backroomOf(productId)).toBeCloseTo(4, 3);
      expect(await vitrineOf(productId)).toBeCloseTo(6, 3);

      const lotCost = num((await p().query(`SELECT unit_cost FROM product_lots WHERE id = $1`, [productLotId])).rows[0].unit_cost);
      const sale = await saleRepo.create({
        userId: fx.userId, storeId: fx.storeId,
        subtotal: 12, taxAmount: 0, discountAmount: 0, total: 12, paymentMethod: 'cash',
        items: [{ productId, quantity: 4, unitPrice: 3, subtotal: 12 }],      // 4 × 3 DH = 12 DH
      });
      saleId = sale.id;
      // Montant encaissé = 4 × 3 = 12,00 DH, payé comptant
      expect(num(sale.total)).toBeCloseTo(12, 2);
      expect(sale.payment_status).toBe('paid');
      // Vitrine 6 − 4 = 2 ; réserve inchangée 4 → stock produit total 6
      expect(await vitrineOf(productId)).toBeCloseTo(2, 3);
      expect(await backroomOf(productId)).toBeCloseTo(4, 3);
      // Lot : 4 vendus, 2 en vitrine, 4 en réserve (10 = 4 + 2 + 4)
      const lot = await p().query(`SELECT sold_qty, vitrine_qty, backroom_qty FROM product_lots WHERE id = $1`, [productLotId]);
      expect([num(lot.rows[0].sold_qty), num(lot.rows[0].vitrine_qty), num(lot.rows[0].backroom_qty)]).toEqual([4, 2, 4]);
      // Traçabilité lot → ticket : 4 pains du lot produit
      const links = await p().query(
        `SELECT sil.product_lot_id, sil.quantity FROM sale_item_lots sil JOIN sale_items si ON si.id = sil.sale_item_id WHERE si.sale_id = $1`, [saleId]);
      expect(links.rows).toHaveLength(1);
      expect(links.rows[0].product_lot_id).toBe(productLotId);
      expect(num(links.rows[0].quantity)).toBe(4);
      // Coût figé sur la ligne de vente = coût du lot consommé ; marge = 12 − 4 × coût lot
      const si = await p().query(`SELECT unit_cost FROM sale_items WHERE sale_id = $1`, [saleId]);
      expect(num(si.rows[0].unit_cost)).toBeCloseTo(lotCost, 4);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 2. VENTE → CAISSE : annulation, clôture, nouvelle session
  // ════════════════════════════════════════════════════════════════════════════
  describe('2. Vente → Caisse (annulation, clôture, nouvelle session)', () => {
    let productId: string; let lotId: string;
    let session1: string; let session2: string;
    let saleA: string; let saleB: string;
    let closedSnapshot: Record<string, unknown>;

    beforeAll(async () => {
      productId = (await p().query(
        `INSERT INTO products (name, slug, price, sale_type, sale_unit) VALUES ($1, $2, 10, 'jour', 'unit') RETURNING id`,
        [`Croissant P2 ${RUN}`, `croissant-p2-${RUN}`])).rows[0].id;
      fx.ids.products.push(productId);
      // 10 croissants en vitrine, un lot à DLC J+5.
      await p().query(
        `INSERT INTO product_store_stock (product_id, store_id, stock_quantity, stock_min_threshold, vitrine_quantity) VALUES ($1, $2, 0, 0, 10)`,
        [productId, fx.storeId]);
      lotId = (await p().query(
        `INSERT INTO product_lots (product_id, store_id, lot_number, quantity_total, vitrine_qty, backroom_qty, sold_qty, produced_at, expires_at, status)
         VALUES ($1, $2, $3, 10, 10, 0, 0, NOW(), CURRENT_DATE + 5, 'active') RETURNING id`,
        [productId, fx.storeId, `P2-${RUN}`.slice(0, 40)])).rows[0].id;
      session1 = (await cashRepo.open(fx.userId, 100, fx.storeId)).id;    // fond de caisse 100 DH
      sessionIds.push(session1);
    }, 60_000);

    const sell = async (sessionId: string, qty: number) => (await saleRepo.create({
      userId: fx.userId, storeId: fx.storeId, sessionId,
      subtotal: qty * 10, taxAmount: 0, discountAmount: 0, total: qty * 10, paymentMethod: 'cash',
      items: [{ productId, quantity: qty, unitPrice: 10, subtotal: qty * 10 }],
    })).id as string;

    it('deux ventes encaissées puis annulation motivée de la 2e : vitrine restituée', async () => {
      saleA = await sell(session1, 2);   // 2 × 10 = 20 DH
      saleB = await sell(session1, 3);   // 3 × 10 = 30 DH
      // Vitrine = 10 − 2 − 3 = 5
      expect(await vitrineOf(productId)).toBeCloseTo(5, 3);
      const row = await saleRepo.cancel(saleB, { userId: fx.userId, approverId: fx.userId, reason: 'Erreur de saisie client' });
      expect(row.cancelled_at).toBeTruthy();
      expect(row.cancel_reason).toBe('Erreur de saisie client');
      // Vitrine magasin = 5 + 3 restitués = 8
      expect(await vitrineOf(productId)).toBeCloseTo(8, 3);
    });

    // CONSTAT : saleRepository.cancel (sale.repository.ts:840-847) restitue
    // product_store_stock.vitrine_quantity mais ne recrédite PAS le lot (product_lots.vitrine_qty /
    // sold_qty) ni les liens sale_item_lots. Le lot affiche encore 5 vendus et 5 en vitrine alors
    // que la vitrine magasin dit 8 : stock par lot et stock magasin divergent (FEFO, rappel de lot).
    it.fails('annulation : le lot d\'origine est recrédité (vitrine 8, vendus 2) [CONSTAT]', async () => {
      const lot = await p().query(`SELECT vitrine_qty, sold_qty FROM product_lots WHERE id = $1`, [lotId]);
      // Attendu : vitrine lot = 10 − 2 = 8 ; vendus = 2 (la vente B annulée ne compte plus)
      expect([num(lot.rows[0].vitrine_qty), num(lot.rows[0].sold_qty)]).toEqual([8, 2]);
    });

    // CONSTAT : cashRegisterRepository.close (cash-register.repository.ts:250-272) agrège
    // `FROM sales WHERE session_id = $1 AND payment_status IS DISTINCT FROM 'unpaid'` sans filtrer
    // `cancelled_at IS NULL` : le ticket annulé (30 DH) est compté dans le CA, le cash et le
    // tiroir attendu. Conséquence : un faux manquant de 30 DH au comptage (et son écriture 658).
    it.fails('clôture : le total exclut la vente annulée (1 vente, 20 DH, tiroir attendu 120) [CONSTAT]', async () => {
      await cashRepo.close(session1);
      const s = (await p().query(`SELECT total_sales, total_revenue, cash_revenue, expected_cash FROM cash_register_sessions WHERE id = $1`, [session1])).rows[0];
      // 1 vente valide (A) ; CA = 20 ; espèces = 20 ; tiroir attendu = fond 100 + 20 = 120
      expect(Number(s.total_sales)).toBe(1);
      expect(num(s.total_revenue)).toBeCloseTo(20, 2);
      expect(num(s.cash_revenue)).toBeCloseTo(20, 2);
      expect(num(s.expected_cash)).toBeCloseTo(120, 2);
    });

    it('comptage du tiroir : 120 DH réels comptés, session clôturée et verrouillée', async () => {
      // close() est idempotent sur la session ouverte (le test précédent a pu l'appeler).
      await cashRepo.close(session1);
      const before = (await p().query(`SELECT expected_cash FROM cash_register_sessions WHERE id = $1`, [session1])).rows[0];
      // Tiroir réel = fond 100 + vente A 20 = 120 DH. Motif fourni seulement si l'écart dépasse 5 DH.
      const diff = 120 - num(before.expected_cash);
      const row = await cashRepo.submitActualAmount(session1, 120, 'Comptage parcours pilote', Math.abs(diff) > 5 ? 'erreur_comptage' : undefined, null);
      expect(row.status).toBe('closed');
      expect(row.locked_at).toBeTruthy();
      closedSnapshot = (await p().query(
        `SELECT total_sales, total_revenue, cash_revenue, expected_cash, actual_amount, difference, closed_at FROM cash_register_sessions WHERE id = $1`, [session1])).rows[0];
      // Comptage enregistré = 120
      expect(num(closedSnapshot.actual_amount)).toBeCloseTo(120, 2);
      // Une annulation après clôture est refusée (avoir obligatoire)
      await expect(saleRepo.cancel(saleA, { userId: fx.userId, approverId: fx.userId, reason: 'trop tard' })).rejects.toThrow(/clôturée/);
    });

    it('journée suivante : nouvelle session, la vente s\'y rattache, la session clôturée ne bouge pas', async () => {
      session2 = (await cashRepo.open(fx.userId, 120, fx.storeId)).id;   // fond = tiroir compté la veille
      sessionIds.push(session2);
      const saleC = await sell(session2, 1);   // 1 × 10 = 10 DH
      const sc = (await p().query(`SELECT session_id FROM sales WHERE id = $1`, [saleC])).rows[0];
      expect(sc.session_id).toBe(session2);
      // Vitrine magasin = 8 − 1 = 7
      expect(await vitrineOf(productId)).toBeCloseTo(7, 3);
      await cashRepo.close(session2);
      const s2 = (await p().query(`SELECT total_sales, total_revenue, expected_cash FROM cash_register_sessions WHERE id = $1`, [session2])).rows[0];
      // Session 2 : 1 vente, 10 DH ; tiroir attendu = 120 + 10 = 130
      expect(Number(s2.total_sales)).toBe(1);
      expect(num(s2.total_revenue)).toBeCloseTo(10, 2);
      expect(num(s2.expected_cash)).toBeCloseTo(130, 2);
      // Session 1 figée : totaux identiques à ceux relevés à sa clôture
      const s1 = (await p().query(
        `SELECT total_sales, total_revenue, cash_revenue, expected_cash, actual_amount, difference, closed_at FROM cash_register_sessions WHERE id = $1`, [session1])).rows[0];
      expect(s1).toEqual(closedSnapshot);
      await cashRepo.submitActualAmount(session2, 130, 'Comptage J+1', undefined, null);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 3. INVENTAIRE → VALORISATION
  // ════════════════════════════════════════════════════════════════════════════
  describe('3. Inventaire → Valorisation', () => {
    let sucreId: string; let lotId: string; let countId: string;

    beforeAll(async () => {
      sucreId = await createIngredient(fx, { name: 'Sucre P3', unit: 'kg', unitCost: 9 });
      lotId = await createLot(fx, { ingredientId: sucreId, lotNumber: 'P3', pesage: 20, expiresInDays: 90, unitCost: 9 });  // 20 kg à 9 DH
    }, 60_000);

    it('comptage : théorique 20 kg figé, compté 18,5 kg → écart −1,5 kg', async () => {
      const r = await stockCountRepo.create({ title: `Inventaire P3 ${RUN}`, itemKinds: 'ingredient', ingredientIds: [sucreId], blind: false }, { userId: fx.userId, storeId: fx.storeId });
      if ('error' in r) throw new Error(r.error);
      countId = r.data.id; countIds.push(countId);
      expect(r.data.lines).toHaveLength(1);
      const line = r.data.lines[0];
      // Théorique à l'ouverture = 20 kg (somme économat + pesage des lots du magasin)
      expect(num(line.theoretical_at_start)).toBeCloseTo(20, 3);
      const c = await stockCountRepo.count(countId, line.id, { countedQty: 18.5, userId: fx.userId });
      expect(c.error).toBeUndefined();
      const l = (await p().query(`SELECT counted_qty, theoretical_at_count FROM stock_count_lines WHERE id = $1`, [line.id])).rows[0];
      // Théorique figé au comptage = 20 ; compté = 18,5
      expect(num(l.theoretical_at_count)).toBeCloseTo(20, 3);
      expect(num(l.counted_qty)).toBeCloseTo(18.5, 3);
    });

    it('soumission puis validation : stock ajusté à 18,5 kg, perte valorisée −13,50 DH', async () => {
      const s = await stockCountRepo.setStatus(countId, 'submit', fx.userId);
      expect(s.error).toBeUndefined();
      expect(s.data.status).toBe('review');
      const v = await stockCountRepo.validate(countId, { zeroUncounted: false, userId: fx.userId });
      expect(v.error).toBeUndefined();
      expect(v.data.status).toBe('validated');
      // Écart = 18,5 − 20 = −1,5 kg ; valeur = −1,5 × 9 (CMUP) = −13,50 DH
      expect(num(v.data.loss_value)).toBeCloseTo(-13.5, 2);
      expect(num(v.data.gain_value)).toBeCloseTo(0, 2);
      expect(num(v.data.gap_value)).toBeCloseTo(-13.5, 2);
      expect(num(v.data.lines[0].applied_qty)).toBeCloseTo(-1.5, 4);
      // Stock matière = 20 − 1,5 = 18,5 kg (inventaire et lot)
      expect(await ingredientStockOf(sucreId)).toBeCloseTo(18.5, 3);
      const lot = (await p().query(`SELECT (economat_quantity + pesage_quantity)::float8 AS q FROM ingredient_lots WHERE id = $1`, [lotId])).rows[0];
      expect(num(lot.q)).toBeCloseTo(18.5, 3);
      // Mouvement d'inventaire tracé : −1,5 kg
      const tx = (await p().query(`SELECT SUM(quantity_change)::float8 AS q FROM inventory_transactions WHERE ingredient_id = $1 AND type = 'inventory'`, [sucreId])).rows[0];
      expect(num(tx.q)).toBeCloseTo(-1.5, 4);
    });

    it('valeur du stock à date (fn_stock_at) : 18,5 kg × 9 DH = 166,50 DH', async () => {
      const at = await stockValRepo.stockAt(localDay(0), fx.storeId);
      const line = at.lines.find((l: any) => l.ingredient_id === sucreId);
      expect(line).toBeDefined();
      // Quantité = 18,5 kg ; coût = 9 ; valeur = 18,5 × 9 = 166,50 DH
      expect(line.quantity).toBeCloseTo(18.5, 3);
      expect(line.unit_cost).toBeCloseTo(9, 4);
      expect(line.value).toBeCloseTo(166.5, 2);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 4. DÉPENSE FOURNISSEUR → TRÉSORERIE
  // ════════════════════════════════════════════════════════════════════════════
  describe('4. Dépense fournisseur → Trésorerie', () => {
    let supplierId: string; let invoiceId: string; let invoiceNumber: string; let paymentId: string;
    let categoryId: string; let chargeCode: string;
    const today = localDay(0);
    const due = localDay(30);

    /** Mouvements au grand livre (écritures validées) des pièces données, par compte. */
    const ledgerByAccount = async (sourceIds: string[]) => {
      const r = await p().query(
        `SELECT a.code, SUM(l.debit)::float8 AS d, SUM(l.credit)::float8 AS c
           FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id JOIN accounts a ON a.id = l.account_id
          WHERE e.source_id = ANY($1::uuid[]) AND e.status = 'posted' AND e.store_id = $2
          GROUP BY a.code`, [sourceIds, fx.storeId]);
      return Object.fromEntries(r.rows.map(x => [x.code as string, { d: num(x.d), c: num(x.c) }]));
    };

    beforeAll(async () => {
      supplierId = await newSupplier('Imprimerie P4');
      // Catégorie de charge rattachée à un compte (sans catégorie, l'écriture part en file
      // d'attente : « Charge sans catégorie », mig 311 G-D8-09).
      const cat = (await p().query(
        `SELECT ec.id, a.code FROM expense_categories ec JOIN accounts a ON a.id = ec.account_id
          WHERE a.code LIKE '61%' ORDER BY a.code LIMIT 1`)).rows[0];
      categoryId = cat.id; chargeCode = cat.code;
    }, 60_000);

    it('facture fournisseur 1 000 HT + 200 TVA = 1 200 TTC, validée, attendue à J+30 dans la prévision', async () => {
      const inv = await invoiceRepo.create({
        invoiceType: 'received', supplierId, categoryId, invoiceDate: today, dueDate: due,
        amount: 1000, taxAmount: 200, totalAmount: 1200,                  // 1 000 + 200 = 1 200
        createdBy: fx.userId, storeId: fx.storeId, notes: `Parcours pilote ${RUN}`,
      });
      invoiceId = inv.id; invoiceNumber = inv.invoice_number; invoiceIds.push(invoiceId);
      const v = await invoiceRepo.validate(invoiceId, { supplierInvoiceNumber: `FS-${RUN}`, declaredHt: 1000, declaredVat: 200, declaredTtc: 1200 }, fx.userId);
      expect(v.validation_status).toBe('validated');
      // Écriture d'achat : charge 1 000 D + TVA récupérable 200 D / fournisseur 4411 1 200 C
      const gl = await ledgerByAccount([invoiceId]);
      expect(gl[chargeCode]?.d ?? 0).toBeCloseTo(1000, 2);
      const tva = Object.entries(gl).filter(([code]) => code.startsWith('345')).reduce((t, [, x]) => t + x.d, 0);
      expect(tva).toBeCloseTo(200, 2);
      expect(gl['4411']?.c ?? 0).toBeCloseTo(1200, 2);
      // Prévision : sortie de −1 200 DH à l'échéance J+30
      const fc = await cashForecast.cashForecast({ from: today });
      const flows = fc.flows.filter((f: any) => f.ref === invoiceNumber);
      expect(flows).toEqual([expect.objectContaining({ date: due, amount: -1200, category: 'fournisseurs' })]);
    });

    it('règlement par virement de 1 200 DH : facture soldée, banque 5141 −1 200, fournisseur lettré à 0, sortie retirée de la prévision', async () => {
      const pay = await paymentRepo.create({
        type: 'invoice', invoiceId, supplierId, amount: 1200, paymentMethod: 'transfer', reference: `VIR-${RUN}`,
        paymentDate: today, description: `Règlement ${invoiceNumber}`, createdBy: fx.userId, storeId: fx.storeId,
      });
      paymentId = pay.id; paymentIds.push(paymentId);
      const inv = (await p().query(`SELECT status, payment_status, paid_amount FROM invoices WHERE id = $1`, [invoiceId])).rows[0];
      // Payé = 1 200 = TTC → facture soldée
      expect(num(inv.paid_amount)).toBeCloseTo(1200, 2);
      expect(inv.status).toBe('paid');
      expect(inv.payment_status).toBe('paid');

      const gl = await ledgerByAccount([invoiceId, paymentId]);
      // Banque 5141 : crédit 1 200 (sortie) → solde du mouvement = −1 200
      expect((gl['5141']?.d ?? 0) - (gl['5141']?.c ?? 0)).toBeCloseTo(-1200, 2);
      // Caisse 5161 non touchée (virement)
      expect(gl['5161']).toBeUndefined();
      // Fournisseur 4411 : 1 200 C (facture) − 1 200 D (règlement) = 0
      expect((gl['4411']?.c ?? 0) - (gl['4411']?.d ?? 0)).toBeCloseTo(0, 2);
      // Écritures équilibrées : total débit = total crédit = 1 200 (achat) + 1 200 (règlement) = 2 400
      const totD = Object.values(gl).reduce((t, x) => t + x.d, 0);
      const totC = Object.values(gl).reduce((t, x) => t + x.c, 0);
      expect(totD).toBeCloseTo(2400, 2);
      expect(totC).toBeCloseTo(2400, 2);
      // Aucune écriture en échec dans la file d'attente
      const outbox = (await p().query(`SELECT COUNT(*)::int AS n FROM ledger_outbox WHERE source_id = ANY($1::uuid[]) AND status <> 'posted'`, [[invoiceId, paymentId]])).rows[0];
      expect(outbox.n).toBe(0);
      // Prévision : la facture payée ne figure plus parmi les sorties à venir
      const fc = await cashForecast.cashForecast({ from: today });
      expect(fc.flows.filter((f: any) => f.ref === invoiceNumber)).toEqual([]);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 5. PAIE → BULLETIN MENSUEL
  // ════════════════════════════════════════════════════════════════════════════
  describe('5. Paie → Bulletin mensuel', () => {
    // Mois isolé (aucune autre suite ne l'utilise) : mars 2097, base 26 jours.
    const MONTH = 3; const YEAR = 2097;
    let empId: string; let payroll: any;

    beforeAll(async () => {
      empId = (await p().query(
        `INSERT INTO employees (first_name, last_name, role, hire_date, pay_frequency, monthly_salary, is_declared, nb_dependents, cimr_rate, is_active, store_id)
         VALUES ('Karim', $1, 'baker', '2096-06-01', 'monthly', 8000, true, 0, 0, true, $2) RETURNING id`,
        [`Pilote ${RUN}`, fx.storeId])).rows[0].id;
      employeeIds.push(empId);
      // 26 jours pointés présents (1er au 26 mars) : aucun jour retenu sur la base 26.
      for (let d = 1; d <= 26; d++) {
        await p().query(`INSERT INTO attendance (employee_id, date, status, is_expected) VALUES ($1, $2, 'present', false)`,
          [empId, `${YEAR}-03-${String(d).padStart(2, '0')}`]);
      }
    }, 60_000);

    it('barème en vigueur : celui sur lequel repose le calcul à la main', async () => {
      const ctx = await payrollCfg.loadPayrollContext(MONTH, YEAR);
      // Précondition du calcul ci-dessous (barème LF 2025 du code / de la base)
      expect(ctx.baseDays).toBe(26);
      expect(ctx.scale).toMatchObject({
        cnssPlafond: 6000, cnssRateEmployee: 0.0448, cnssRateEmployer: 0.0898,
        amoRateEmployee: 0.0226, amoRateEmployer: 0.0411, allocFamilialesRate: 0.064, taxeFpRate: 0.016,
        fraisProRateBas: 0.35, fraisProRateHaut: 0.25, fraisProSeuilAnnuel: 78000, fraisProPlafondAnnuel: 35000,
      });
    });

    it('bulletin de mars : salaire 8 000 DH déclaré, sans ancienneté ni charge de famille', async () => {
      // Même chemin que payrollRepository.generate, limité à MON salarié (generate prendrait
      // aussi les salariés sans magasin de la base de test).
      await payrollCfg.payrollPeriodRepository.assertOpen(MONTH, YEAR);
      const ctx = await payrollCfg.loadPayrollContext(MONTH, YEAR);
      const emp = (await p().query(`SELECT * FROM employees WHERE id = $1`, [empId])).rows[0];
      payroll = await payrollCfg.computeAndSavePayslip(emp, MONTH, YEAR, ctx);

      // Jours : 26 pointés sur base 26 → 0 absence
      expect(num(payroll.worked_days)).toBe(26);
      expect(num(payroll.absent_days)).toBe(0);
      // Ancienneté : embauche 01/06/2096 → 0 an révolu au 31/03/2097 → 0 %
      expect(num(payroll.seniority_bonus)).toBeCloseTo(0, 2);
      // Brut = 8 000
      expect(num(payroll.base_salary)).toBeCloseTo(8000, 2);
      expect(num(payroll.gross_salary)).toBeCloseTo(8000, 2);
      // CNSS salariale = min(8 000 ; plafond 6 000) × 4,48 % = 268,80
      expect(num(payroll.cnss_employee)).toBeCloseTo(268.80, 2);
      // AMO salariale = 8 000 × 2,26 % (sans plafond) = 180,80
      expect(num(payroll.amo_employee)).toBeCloseTo(180.80, 2);
      // Frais pro : brut annuel 96 000 > 78 000 → 25 % ; 8 000 × 25 % = 2 000 (< plafond 35 000/12 = 2 916,67)
      expect(num(payroll.frais_pro)).toBeCloseTo(2000, 2);
      // Net imposable = 8 000 − 2 000 − 268,80 − 180,80 = 5 550,40
      expect(num(payroll.net_imposable)).toBeCloseTo(5550.40, 2);
      // IR : 5 550,40 × 12 = 66 604,80 → tranche 20 % (déduction 10 000) :
      //      66 604,80 × 20 % − 10 000 = 3 320,96 / an → / 12 = 276,7466 → 276,75 ; 0 charge de famille
      expect(num(payroll.ir_gross)).toBeCloseTo(276.75, 2);
      expect(num(payroll.ir_net)).toBeCloseTo(276.75, 2);
      // Net = 8 000 − 268,80 − 180,80 − 276,75 = 7 273,65
      expect(num(payroll.net_salary)).toBeCloseTo(7273.65, 2);
      // Charges patronales : CNSS 6 000 × 8,98 % = 538,80 ; AMO 8 000 × 4,11 % = 328,80 ;
      // alloc. familiales 8 000 × 6,40 % = 512,00 ; TFP 8 000 × 1,60 % = 128,00 → total 1 507,60
      expect(num(payroll.cnss_employer)).toBeCloseTo(538.80, 2);
      expect(num(payroll.amo_employer)).toBeCloseTo(328.80, 2);
      expect(num(payroll.alloc_familiales)).toBeCloseTo(512, 2);
      expect(num(payroll.taxe_fp)).toBeCloseTo(128, 2);
      expect(num(payroll.total_charges_patron)).toBeCloseTo(1507.60, 2);
      expect(payroll.paid).toBe(false);

      // La seule génération ne crée AUCUNE écriture, aucun paiement, rien en file d'attente
      // (provision 4432 et règlement : au paiement ; tâches G1-07/G1-08 désactivées).
      const je = (await p().query(`SELECT COUNT(*)::int AS n FROM journal_entries WHERE source_id = $1`, [payroll.id])).rows[0];
      expect(je.n).toBe(0);
      const ob = (await p().query(`SELECT COUNT(*)::int AS n FROM ledger_outbox WHERE source_id = $1`, [payroll.id])).rows[0];
      expect(ob.n).toBe(0);
      const pay = (await p().query(`SELECT COUNT(*)::int AS n FROM payments WHERE employee_id = $1`, [empId])).rows[0];
      expect(pay.n).toBe(0);
    });

    it('régénération : bulletin recalculé à l\'identique (upsert, pas de doublon)', async () => {
      const ctx = await payrollCfg.loadPayrollContext(MONTH, YEAR);
      const emp = (await p().query(`SELECT * FROM employees WHERE id = $1`, [empId])).rows[0];
      const again = await payrollCfg.computeAndSavePayslip(emp, MONTH, YEAR, ctx);
      expect(again.id).toBe(payroll.id);
      expect(num(again.net_salary)).toBeCloseTo(7273.65, 2);
      const n = (await p().query(`SELECT COUNT(*)::int AS n FROM payroll WHERE employee_id = $1 AND month = $2 AND year = $3`, [empId, MONTH, YEAR])).rows[0];
      expect(n.n).toBe(1);
    });
  });
});
