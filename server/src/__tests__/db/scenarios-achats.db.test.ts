/**
 * Scénarios réalistes — domaine ACHATS (BC → envoi → réception → CMUP → facture).
 *
 * On joue des parcours « responsable achats / magasinier » de bout en bout sur la
 * vraie base migrée (kalum_test), en appelant les repositories et le contrôleur réels.
 * Chaque assertion encode le comportement ATTENDU. Les écarts constatés sont marqués
 * par `it.fails(...)` ou un commentaire `// CONSTAT:` (jamais un test affaibli).
 *
 * Isolation : tout est suffixé par RUN et nettoyé en afterAll. Les gardes globales
 * sensibles (plafond d'approbation → table approval_limits partagée) sont posées et
 * retirées DANS le test concerné pour ne pas polluer les suites parallèles.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.middleware.js';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, cleanupFixtures, RUN, num, type Fixtures,
} from './helpers.js';

const SAC = 'dfb5eb29-8fec-4ad9-a788-74c989bd8ef7'; // ref_entries container_types 'sac'

describe.skipIf(!hasTestDb)('Scénarios ACHATS (BC → réception → CMUP → facture)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let poRepo: typeof import('../../repositories/purchase-order.repository.js').purchaseOrderRepository;
  let poActions: typeof import('../../repositories/purchase-order-actions.repository.js').purchaseOrderActionsRepository;
  let poController: typeof import('../../controllers/purchase-order.controller.js').purchaseOrderController;
  let fx: Fixtures;
  let supplierId: string;
  let managerUserId: string;
  const poIds: string[] = [];
  const packagingIds: string[] = [];

  // ─── Fake Express req/res pour tester le contrôleur (gardes d'envoi) ───
  interface CapturedRes { statusCode: number; body: unknown }
  function fakeRes(): Response & CapturedRes {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = { statusCode: 200, body: undefined };
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: unknown) => { res.body = b; return res; };
    return res as Response & CapturedRes;
  }
  function fakeReq(poId: string, user: { userId: string; role: string; storeId?: string }, body: Record<string, unknown> = {}): AuthRequest {
    return { params: { id: poId }, query: {}, body, user } as unknown as AuthRequest;
  }

  async function createPo(items: { ingredientId?: string | null; packagingId?: string | null; quantityOrdered: number; unitPrice?: number | null }[]) {
    const po = await poRepo.create({
      supplierId, createdBy: fx.userId, storeId: fx.storeId, items,
    } as Parameters<typeof poRepo.create>[0]);
    poIds.push(po.id);
    return po;
  }

  async function createPackaging(name: string): Promise<string> {
    const r = await testPool().query(
      `INSERT INTO packaging_items (name, unit, unit_cost, category) VALUES ($1, 'piece', 0, 'boites') RETURNING id`,
      [`${name} ${RUN}`]
    );
    packagingIds.push(r.rows[0].id);
    return r.rows[0].id;
  }

  beforeAll(async () => {
    repos = await importRepositories();
    poRepo = (await import('../../repositories/purchase-order.repository.js')).purchaseOrderRepository;
    poActions = (await import('../../repositories/purchase-order-actions.repository.js')).purchaseOrderActionsRepository;
    poController = (await import('../../controllers/purchase-order.controller.js')).purchaseOrderController;
    fx = await createBaseFixtures();
    const p = testPool();
    const sup = await p.query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`Fournisseur achats ${RUN}`]);
    supplierId = sup.rows[0].id;
    // Utilisateur non-admin (rôle « manager ») pour le test de plafond d'approbation.
    const mgr = await p.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, store_id)
       VALUES ($1, 'x', 'Manager', 'Achats', 'manager', $2) RETURNING id`,
      [`mgr-${RUN}@test.local`, fx.storeId]
    );
    managerUserId = mgr.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    const p = testPool();
    const run = async (sql: string, params: unknown[]) => { try { await p.query(sql, params); } catch { /* best effort */ } };
    // Comptabilité éventuellement générée depuis mes BC.
    await run(`DELETE FROM ledger_outbox WHERE source_id IN (
                 SELECT rvi.id FROM reception_voucher_items rvi JOIN reception_vouchers rv ON rv.id = rvi.reception_voucher_id
                  WHERE rv.purchase_order_id = ANY($1))`, [poIds]);
    await run(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE purchase_order_id = ANY($1))`, [poIds]);
    await run(`DELETE FROM invoice_purchase_orders WHERE purchase_order_id = ANY($1)`, [poIds]);
    await run(`DELETE FROM invoices WHERE purchase_order_id = ANY($1)`, [poIds]);
    await run(`DELETE FROM inventory_transactions WHERE reception_voucher_id IN (SELECT id FROM reception_vouchers WHERE purchase_order_id = ANY($1))`, [poIds]);
    await run(`DELETE FROM ingredient_lots WHERE reception_voucher_item_id IN (
                 SELECT rvi.id FROM reception_voucher_items rvi JOIN reception_vouchers rv ON rv.id = rvi.reception_voucher_id
                  WHERE rv.purchase_order_id = ANY($1))`, [poIds]);
    await run(`DELETE FROM reception_voucher_items WHERE reception_voucher_id IN (SELECT id FROM reception_vouchers WHERE purchase_order_id = ANY($1))`, [poIds]);
    await run(`DELETE FROM reception_vouchers WHERE purchase_order_id = ANY($1)`, [poIds]);
    await run(`DELETE FROM po_line_events WHERE po_line_id IN (SELECT id FROM purchase_order_items WHERE purchase_order_id = ANY($1))`, [poIds]);
    await run(`DELETE FROM purchase_order_versions WHERE purchase_order_id = ANY($1)`, [poIds]);
    await run(`DELETE FROM purchase_order_items WHERE purchase_order_id = ANY($1)`, [poIds]);
    await run(`DELETE FROM document_actions WHERE document_id = ANY($1)`, [poIds]);
    await run(`DELETE FROM purchase_orders WHERE id = ANY($1)`, [poIds]);
    await run(`DELETE FROM packaging_store_stock WHERE packaging_id = ANY($1)`, [packagingIds]);
    await run(`DELETE FROM packaging_stock_transactions WHERE packaging_id = ANY($1)`, [packagingIds]);
    await run(`DELETE FROM packaging_items WHERE id = ANY($1)`, [packagingIds]);
    await run(`DELETE FROM approval_limits WHERE role_code = 'manager' AND document_type = 'purchase_order'`, []);
    await run(`DELETE FROM users WHERE id = $1`, [managerUserId]);
    await run(`DELETE FROM suppliers WHERE id = $1`, [supplierId]);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  }, 60_000);

  // ════════════════════════════ A. CRÉATION DE BC ════════════════════════════

  it('A1 — crée un BC ingrédient chiffré (statut en_attente, ligne stockée)', async () => {
    const ingId = await createIngredient(fx, { name: 'Farine A1', unit: 'kg', unitCost: 12 });
    const po = await createPo([{ ingredientId: ingId, quantityOrdered: 50, unitPrice: 12 }]);

    expect(po.status).toBe('en_attente');
    expect(po.order_number).toBeTruthy();
    // Pas d'arrondi contenant (ingrédient sans contenant défini).
    expect(po._roundings).toHaveLength(0);

    const line = await testPool().query(
      `SELECT quantity_ordered, unit_price, packaging_id FROM purchase_order_items WHERE purchase_order_id = $1`, [po.id]);
    expect(line.rows).toHaveLength(1);
    expect(num(line.rows[0].quantity_ordered)).toBeCloseTo(50, 3);
    expect(num(line.rows[0].unit_price)).toBeCloseTo(12, 3);
    expect(line.rows[0].packaging_id).toBeNull();
  });

  it('A2 — crée un BC consommable (packaging_id porté par la ligne)', async () => {
    const pkgId = await createPackaging('Boite 1kg A2');
    const po = await createPo([{ packagingId: pkgId, quantityOrdered: 200, unitPrice: 1.5 }]);

    expect(po.status).toBe('en_attente');
    const line = await testPool().query(
      `SELECT ingredient_id, packaging_id, quantity_ordered FROM purchase_order_items WHERE purchase_order_id = $1`, [po.id]);
    expect(line.rows).toHaveLength(1);
    expect(line.rows[0].packaging_id).toBe(pkgId);
    expect(line.rows[0].ingredient_id).toBeNull();
    expect(num(line.rows[0].quantity_ordered)).toBeCloseTo(200, 3);
  });

  it('A3 — arrondi au contenant : 42 kg en sacs de 25 → 50 kg (2 sacs), _roundings signalé', async () => {
    const ingId = await createIngredient(fx, { name: 'Sucre A3', unit: 'kg', unitCost: 8 });
    await testPool().query(
      `UPDATE ingredients SET container_size = 25, container_type_id = $2 WHERE id = $1`, [ingId, SAC]);

    const po = await createPo([{ ingredientId: ingId, quantityOrdered: 42, unitPrice: 8 }]);
    expect(po._roundings).toHaveLength(1);
    expect(po._roundings[0].requested).toBeCloseTo(42, 3);
    expect(po._roundings[0].ordered).toBeCloseTo(50, 3);
    expect(po._roundings[0].containers).toBe(2);

    const line = await testPool().query(
      `SELECT quantity_ordered FROM purchase_order_items WHERE purchase_order_id = $1`, [po.id]);
    expect(num(line.rows[0].quantity_ordered)).toBeCloseTo(50, 3);
  });

  // ════════════════════════════ B. GARDE D'ENVOI ════════════════════════════

  it('B1 — refuse l\'envoi d\'un BC non chiffré (409 PO_UNPRICED)', async () => {
    const ingId = await createIngredient(fx, { name: 'Beurre B1', unit: 'kg', unitCost: 60 });
    const po = await createPo([{ ingredientId: ingId, quantityOrdered: 10, unitPrice: null }]);

    const res = fakeRes();
    await poController.send(fakeReq(po.id, { userId: fx.userId, role: 'admin', storeId: fx.storeId }), res);

    expect(res.statusCode).toBe(409);
    const body = res.body as { error?: { code?: string } };
    expect(body.error?.code).toBe('PO_UNPRICED');
    // La garde ne doit PAS envoyer le BC.
    const st = await testPool().query(`SELECT status FROM purchase_orders WHERE id = $1`, [po.id]);
    expect(st.rows[0].status).toBe('en_attente');
  });

  it('B2 — refuse le ré-envoi d\'un BC déjà envoyé (contrôleur 409 + repo PO_NOT_DRAFT)', async () => {
    const ingId = await createIngredient(fx, { name: 'Levure B2', unit: 'kg', unitCost: 5 });
    const po = await createPo([{ ingredientId: ingId, quantityOrdered: 4, unitPrice: 5 }]);

    // 1er envoi : admin (plafond infini), BC chiffré → OK.
    const res1 = fakeRes();
    await poController.send(fakeReq(po.id, { userId: fx.userId, role: 'admin', storeId: fx.storeId }), res1);
    expect(res1.statusCode).toBe(200);
    const sent = await testPool().query(`SELECT status FROM purchase_orders WHERE id = $1`, [po.id]);
    expect(sent.rows[0].status).toBe('envoye');

    // 2e envoi via contrôleur → 409 (garde de statut).
    const res2 = fakeRes();
    await poController.send(fakeReq(po.id, { userId: fx.userId, role: 'admin', storeId: fx.storeId }), res2);
    expect(res2.statusCode).toBe(409);

    // Au niveau repo : la transition est refusée avec le code PO_NOT_DRAFT.
    await expect(poActions.send(po.id, fx.userId, fx.storeId)).rejects.toMatchObject({ code: 'PO_NOT_DRAFT' });
  });

  // F-083 (P1) — CORRIGÉ. Le plafond d'approbation était contourné à l'envoi :
  // purchaseOrderController.send lisait `po.total_amount` via findById, qui NE le
  // calcule PAS (purchase_orders n'a pas la colonne) → amount valait toujours 0 et
  // checkApprovalLimit passait quel que soit le montant réel (garde morte, mig 336).
  // Correctif : send() calcule désormais le montant depuis les lignes
  // (SUM quantity_ordered × unit_price). Ce test valide le refus 403 attendu.
  it('B3 — plafond d\'approbation : un BC au-dessus du plafond est refusé (403) [F-083]', async () => {
    const p = testPool();
    const ingId = await createIngredient(fx, { name: 'Chocolat B3', unit: 'kg', unitCost: 100 });
    // BC chiffré à 1000 (10 × 100), bien au-dessus du plafond manager fixé à 50.
    const po = await createPo([{ ingredientId: ingId, quantityOrdered: 10, unitPrice: 100 }]);

    // Plafond posé et retiré dans ce test seul (table approval_limits partagée).
    await p.query(
      `INSERT INTO approval_limits (role_code, document_type, max_amount, updated_by)
       VALUES ('manager', 'purchase_order', 50, $1)
       ON CONFLICT (role_code, document_type) DO UPDATE SET max_amount = EXCLUDED.max_amount`,
      [fx.userId]
    );
    try {
      const res = fakeRes();
      await poController.send(fakeReq(po.id, { userId: managerUserId, role: 'manager', storeId: fx.storeId }), res);
      // ATTENDU : 403. OBSERVÉ : 200 (plafond contourné, cf. CONSTAT ci-dessus).
      expect(res.statusCode).toBe(403);
      const body = res.body as { error?: { message?: string } };
      expect(body.error?.message).toMatch(/plafond/i);
    } finally {
      await p.query(`DELETE FROM approval_limits WHERE role_code = 'manager' AND document_type = 'purchase_order'`);
    }
  });

  it('B3bis — le plafond d\'approbation est correctement calculé au niveau service (approvalLimitFor)', async () => {
    // Démontre que la donnée est bonne côté gouvernance : seul le contrôleur passe un montant à 0.
    const p = testPool();
    const governance = await import('../../services/governance.js');
    await p.query(
      `INSERT INTO approval_limits (role_code, document_type, max_amount, updated_by)
       VALUES ('manager', 'purchase_order', 50, $1)
       ON CONFLICT (role_code, document_type) DO UPDATE SET max_amount = EXCLUDED.max_amount`,
      [fx.userId]
    );
    try {
      const limit = await governance.approvalLimitFor(managerUserId, 'purchase_order');
      expect(limit).toBeCloseTo(50, 2);
      // Un montant réel au-dessus du plafond serait refusé si le contrôleur le lui passait.
      expect((await governance.checkApprovalLimit(managerUserId, 'purchase_order', 1000)).allowed).toBe(false);
      expect((await governance.checkApprovalLimit(managerUserId, 'purchase_order', 40)).allowed).toBe(true);
    } finally {
      await p.query(`DELETE FROM approval_limits WHERE role_code = 'manager' AND document_type = 'purchase_order'`);
    }
  });

  // ════════════════════════════ C. RÉCEPTION ════════════════════════════

  it('C1 — réception complète : lot créé, inventaire synchronisé, BC livré, facture auto', async () => {
    const ingId = await createIngredient(fx, { name: 'Farine C1', unit: 'kg', unitCost: 10 });
    const po = await createPo([{ ingredientId: ingId, quantityOrdered: 80, unitPrice: 11 }]);
    await poRepo.updateStatus(po.id, 'envoye');

    const detail = await poRepo.findById(po.id);
    const itemId = detail!.items[0].id as string;
    const result = await poRepo.confirmDelivery(
      po.id, [{ itemId, quantityDelivered: 80 }], fx.userId, fx.storeId);

    expect(result.status).toBe('livre_complet');
    expect((result.lotNumbers as string[]).length).toBe(1);

    const p = testPool();
    // Un lot de 80 a été créé pour l'ingrédient.
    const lot = await p.query(
      `SELECT quantity_received, quantity_remaining, unit_cost FROM ingredient_lots
        WHERE ingredient_id = $1 AND status = 'active'`, [ingId]);
    expect(lot.rows).toHaveLength(1);
    expect(num(lot.rows[0].quantity_received)).toBeCloseTo(80, 3);

    // Inventaire synchronisé par le trigger des lots (= stock réel des lots, pas de double comptage).
    const inv = await p.query(`SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [ingId, fx.storeId]);
    expect(inv.rows).toHaveLength(1);
    expect(num(inv.rows[0].current_quantity)).toBeCloseTo(80, 3);

    // Ligne de BC : reçu = commandé.
    const poi = await p.query(`SELECT qty_received_base, quantity_delivered FROM purchase_order_items WHERE purchase_order_id = $1`, [po.id]);
    expect(num(poi.rows[0].qty_received_base)).toBeCloseTo(80, 3);

    // Facture « received » auto-créée au prix reçu (80 × 11 = 880 HT).
    const inv2 = await p.query(
      `SELECT status, invoice_type, amount FROM invoices WHERE purchase_order_id = $1 AND status <> 'cancelled'`, [po.id]);
    expect(inv2.rows).toHaveLength(1);
    expect(inv2.rows[0].invoice_type).toBe('received');
    expect(num(inv2.rows[0].amount)).toBeCloseTo(880, 2);
  });

  it('C2 — réception partielle : reliquat tracé, BC en livre_partiel, pas de facture', async () => {
    const ingId = await createIngredient(fx, { name: 'Lait C2', unit: 'l', unitCost: 4 });
    const po = await createPo([{ ingredientId: ingId, quantityOrdered: 100, unitPrice: 4 }]);
    await poRepo.updateStatus(po.id, 'envoye');

    const detail = await poRepo.findById(po.id);
    const itemId = detail!.items[0].id as string;
    const result = await poRepo.confirmDelivery(po.id, [{ itemId, quantityDelivered: 60 }], fx.userId, fx.storeId);

    expect(result.status).toBe('livre_partiel');

    const p = testPool();
    const poi = await p.query(
      `SELECT quantity_ordered, qty_received_base,
              GREATEST(quantity_ordered - qty_received_base - qty_cancelled_base, 0) AS remainder
         FROM purchase_order_items WHERE purchase_order_id = $1`, [po.id]);
    expect(num(poi.rows[0].qty_received_base)).toBeCloseTo(60, 3);
    // Le reliquat de 40 reste OUVERT et tracé (pas de disparition silencieuse).
    expect(num(poi.rows[0].remainder)).toBeCloseTo(40, 3);

    // Pas de facture tant que le BC n'est pas complet.
    const inv = await p.query(`SELECT 1 FROM invoices WHERE purchase_order_id = $1 AND status <> 'cancelled'`, [po.id]);
    expect(inv.rows).toHaveLength(0);
  });

  it('C3 — sur-réception au-delà de la tolérance (10%) refusée ; dans la tolérance acceptée', async () => {
    const p = testPool();

    // (a) Au-delà de la tolérance : commande 100, réception 120 → refus par le trigger GR.
    const ing1 = await createIngredient(fx, { name: 'Oeufs C3a', unit: 'unit', unitCost: 1 });
    const poA = await createPo([{ ingredientId: ing1, quantityOrdered: 100, unitPrice: 1 }]);
    await poRepo.updateStatus(poA.id, 'envoye');
    const itemA = (await poRepo.findById(poA.id))!.items[0].id as string;
    await expect(
      poRepo.confirmDelivery(poA.id, [{ itemId: itemA, quantityDelivered: 120 }], fx.userId, fx.storeId)
    ).rejects.toThrow(/dépasser|commandé/i);
    // Rien reçu (transaction annulée).
    const poiA = await p.query(`SELECT qty_received_base FROM purchase_order_items WHERE purchase_order_id = $1`, [poA.id]);
    expect(num(poiA.rows[0].qty_received_base)).toBeCloseTo(0, 3);

    // (b) Dans la tolérance : commande 100, réception 110 (exactement +10%) → acceptée.
    const ing2 = await createIngredient(fx, { name: 'Oeufs C3b', unit: 'unit', unitCost: 1 });
    const poB = await createPo([{ ingredientId: ing2, quantityOrdered: 100, unitPrice: 1 }]);
    await poRepo.updateStatus(poB.id, 'envoye');
    const itemB = (await poRepo.findById(poB.id))!.items[0].id as string;
    const resB = await poRepo.confirmDelivery(poB.id, [{ itemId: itemB, quantityDelivered: 110 }], fx.userId, fx.storeId);
    expect(resB.status).toBe('livre_complet');
    const poiB = await p.query(`SELECT qty_received_base FROM purchase_order_items WHERE purchase_order_id = $1`, [poB.id]);
    expect(num(poiB.rows[0].qty_received_base)).toBeCloseTo(110, 3);
  });

  it('C4 — lot/DLC en mode « warn » : réception sans lot fournisseur signalée mais non bloquée', async () => {
    const p = testPool();
    const ingId = await createIngredient(fx, { name: 'Creme C4', unit: 'l', unitCost: 7 });
    // L'ingrédient exige lot + DLC (le mode global reste 'warn' par défaut).
    await p.query(`UPDATE ingredients SET requires_lot = true, requires_dlc = true WHERE id = $1`, [ingId]);

    const po = await createPo([{ ingredientId: ingId, quantityOrdered: 20, unitPrice: 7 }]);
    await poRepo.updateStatus(po.id, 'envoye');
    const itemId = (await poRepo.findById(po.id))!.items[0].id as string;

    // Réception SANS lot ni DLC : en mode warn, acceptée avec avertissement.
    const result = await poRepo.confirmDelivery(po.id, [{ itemId, quantityDelivered: 20 }], fx.userId, fx.storeId);
    expect(result.status).toBe('livre_complet');
    expect(Array.isArray(result.warnings)).toBe(true);
    expect((result.warnings as string[]).some(w => /lot fournisseur|DLC/i.test(w))).toBe(true);

    // Le lot a quand même été créé (réception non bloquée).
    const lot = await p.query(`SELECT 1 FROM ingredient_lots WHERE ingredient_id = $1 AND status = 'active'`, [ingId]);
    expect(lot.rows).toHaveLength(1);
  });

  it('C5 — DLC déjà périmée refusée même en mode warn (marchandise non réceptionnable)', async () => {
    const ingId = await createIngredient(fx, { name: 'Yaourt C5', unit: 'unit', unitCost: 3 });
    const po = await createPo([{ ingredientId: ingId, quantityOrdered: 10, unitPrice: 3 }]);
    await poRepo.updateStatus(po.id, 'envoye');
    const itemId = (await poRepo.findById(po.id))!.items[0].id as string;

    // DLC dans le passé → refus dur (indépendant du mode warn/block).
    await expect(
      poRepo.confirmDelivery(po.id, [{ itemId, quantityDelivered: 10, expirationDate: '2000-01-01' }], fx.userId, fx.storeId)
    ).rejects.toThrow(/dépassée|réceptionn/i);
  });

  // ════════════════════════════ D. CMUP À LA RÉCEPTION ════════════════════════════

  it('D1 — CMUP : deux réceptions à prix différents donnent le coût moyen pondéré', async () => {
    const p = testPool();
    // unit_cost initial volontairement « faux » (99) : la 1re réception le remplace par le prix reçu.
    const ingId = await createIngredient(fx, { name: 'Amande CMUP', unit: 'kg', unitCost: 99 });

    // Réception 1 : 100 kg @ 10 → stock vide avant → unit_cost = 10.
    const po1 = await createPo([{ ingredientId: ingId, quantityOrdered: 100, unitPrice: 10 }]);
    await poRepo.updateStatus(po1.id, 'envoye');
    const it1 = (await poRepo.findById(po1.id))!.items[0].id as string;
    await poRepo.confirmDelivery(po1.id, [{ itemId: it1, quantityDelivered: 100 }], fx.userId, fx.storeId);

    const afterFirst = await p.query(`SELECT unit_cost FROM ingredients WHERE id = $1`, [ingId]);
    expect(num(afterFirst.rows[0].unit_cost)).toBeCloseTo(10, 3);

    // Réception 2 : 100 kg @ 20 → (100×10 + 100×20) / 200 = 15.
    const po2 = await createPo([{ ingredientId: ingId, quantityOrdered: 100, unitPrice: 20 }]);
    await poRepo.updateStatus(po2.id, 'envoye');
    const it2 = (await poRepo.findById(po2.id))!.items[0].id as string;
    await poRepo.confirmDelivery(po2.id, [{ itemId: it2, quantityDelivered: 100 }], fx.userId, fx.storeId);

    const afterSecond = await p.query(`SELECT unit_cost FROM ingredients WHERE id = $1`, [ingId]);
    expect(num(afterSecond.rows[0].unit_cost)).toBeCloseTo(15, 3);

    // Stock agrégé = 200 kg sur deux lots actifs.
    const stock = await p.query(
      `SELECT COALESCE(SUM(economat_quantity + pesage_quantity), 0) AS q, COUNT(*) AS n
         FROM ingredient_lots WHERE ingredient_id = $1 AND status = 'active'`, [ingId]);
    expect(num(stock.rows[0].q)).toBeCloseTo(200, 3);
    expect(Number(stock.rows[0].n)).toBe(2);
  });

  // ════════════════════════════ E. FACTURE ════════════════════════════

  it('E1 — génération manuelle de facture : BC reçu sans prix → facturé après saisie des prix', async () => {
    const p = testPool();
    const ingId = await createIngredient(fx, { name: 'Pistache E1', unit: 'kg', unitCost: 50 });
    // BC sans prix (ligne non chiffrée), reçu complet et sans prix de réception.
    const po = await createPo([{ ingredientId: ingId, quantityOrdered: 10, unitPrice: null }]);
    await poRepo.updateStatus(po.id, 'envoye');
    const itemId = (await poRepo.findById(po.id))!.items[0].id as string;

    const recv = await poRepo.confirmDelivery(po.id, [{ itemId, quantityDelivered: 10 }], fx.userId, fx.storeId);
    // Reçu complet mais prix manquant → en_attente_facturation, pas de facture auto.
    expect(recv.status).toBe('en_attente_facturation');
    const noInv = await p.query(`SELECT 1 FROM invoices WHERE purchase_order_id = $1 AND status <> 'cancelled'`, [po.id]);
    expect(noInv.rows).toHaveLength(0);

    // Tant que le BC n'est pas livre_complet, la génération manuelle est refusée.
    const early = await poRepo.generateInvoice(po.id, fx.userId, fx.storeId);
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.code).toBe('wrong_status');

    // Le responsable saisit le prix a posteriori → BC passe livre_complet.
    await poRepo.updateItemPrices(po.id, [{ itemId, unitPrice: 50 }]);
    const st = await p.query(`SELECT status FROM purchase_orders WHERE id = $1`, [po.id]);
    expect(st.rows[0].status).toBe('livre_complet');

    // Génération manuelle de la facture → OK (10 × 50 = 500 HT).
    const gen = await poRepo.generateInvoice(po.id, fx.userId, fx.storeId);
    expect(gen.ok).toBe(true);
    const inv = await p.query(
      `SELECT invoice_type, amount FROM invoices WHERE purchase_order_id = $1 AND status <> 'cancelled'`, [po.id]);
    expect(inv.rows).toHaveLength(1);
    expect(inv.rows[0].invoice_type).toBe('received');
    expect(num(inv.rows[0].amount)).toBeCloseTo(500, 2);

    // Deuxième génération → refusée (idempotence : une seule facture).
    const dup = await poRepo.generateInvoice(po.id, fx.userId, fx.storeId);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.code).toBe('invoice_exists');
  });
});
