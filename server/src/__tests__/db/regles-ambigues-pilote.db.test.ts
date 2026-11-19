/**
 * Plan pilote 2026-11, section 5 — règles métier ambiguës tranchées (choix prudents).
 *
 * Partie 1 (sans base) : chaque règle portée par un schéma zod, un cas refusé et un cas admis.
 * Partie 2 (base de test) : règle 6, ajustement manuel d'emballage — une diminution supérieure
 * au stock est refusée (400) sans rien écrire, au lieu d'être ramenée à 0.
 * Hors liste : stock-frigo.controller enregistre bien l'auteur (user.userId).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { hasTestDb, testPool, closeTestPool, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';
import * as PUR from '../../validators/purchasing-flow.validator.js';
import * as PAY from '../../validators/payments-flow.validator.js';
import * as PROD from '../../validators/production-flow.validator.js';
import { productTransferSchema, openingCheckSchema } from '../../validators/stock-flow.validator.js';
import { productTransferRulesSchema, openingCheckRulesSchema } from '../../validators/stock-rules.validator.js';

type Schema = { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { issues: { message: string }[] } } };
const ok = (s: Schema, v: unknown) => expect(s.safeParse(v).success, JSON.stringify(s.safeParse(v).error?.issues)).toBe(true);
const ko = (s: Schema, v: unknown, msg?: RegExp) => {
  const r = s.safeParse(v);
  expect(r.success).toBe(false);
  if (msg) expect(r.error!.issues.map(i => i.message).join(' | ')).toMatch(msg);
};
/** Enchaîne deux schémas comme la route : validate(type) puis validate(règle). */
const chain = (a: Schema, b: Schema): Schema => ({
  safeParse: (v: unknown) => { const r = a.safeParse(v); return r.success ? b.safeParse(r.data) : r; },
});
const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

describe('Règles ambiguës du plan pilote — schémas', () => {
  it('1. PUT /purchase-orders/:id/items : quantityDelivered < 0 refusé', () => {
    const line = { ingredientId: ID, quantityOrdered: 10, unitPrice: 5 };
    ko(PUR.replacePoItemsSchema, { items: [{ ...line, quantityDelivered: -1 }] }, /négative/);
    ok(PUR.replacePoItemsSchema, { items: [{ ...line, quantityDelivered: 0 }] });
    ok(PUR.replacePoItemsSchema, { items: [{ ...line, quantityDelivered: '4.5' }] });
    ok(PUR.replacePoItemsSchema, { items: [line] });
  });

  it('2. confirm-delivery et bon de réception : quantité négative refusée (0 admis)', () => {
    ko(PUR.confirmDeliverySchema, { items: [{ itemId: ID, quantityDelivered: -2 }] }, /Quantité livrée négative/);
    ok(PUR.confirmDeliverySchema, { items: [{ itemId: ID, quantityDelivered: 0 }, { itemId: ID2, quantityDelivered: 3 }] });
    ko(PUR.createReceptionVoucherSchema, { purchaseOrderId: ID, items: [{ poItemId: ID, quantityReceived: -1 }] }, /Quantité reçue négative/);
    ok(PUR.createReceptionVoucherSchema, { purchaseOrderId: ID, items: [{ poItemId: ID, quantityReceived: 0 }] });
  });

  it('3. prix d\'achat < 0 refusé, 0 admis (gratuité)', () => {
    ko(PUR.confirmDeliverySchema, { items: [{ itemId: ID, quantityDelivered: 1, unitPrice: -0.5 }] }, /Prix unitaire négatif/);
    ok(PUR.confirmDeliverySchema, { items: [{ itemId: ID, quantityDelivered: 1, unitPrice: 0 }] });
    ok(PUR.confirmDeliverySchema, { items: [{ itemId: ID, quantityDelivered: 1, unitPrice: null }] });
    ko(PUR.updatePoPricesSchema, { items: [{ itemId: ID, unitPrice: -3 }] });
    ok(PUR.updatePoPricesSchema, { items: [{ itemId: ID, unitPrice: 0 }] });
    ko(PUR.replacePoItemsSchema, { items: [{ ingredientId: ID, quantityOrdered: 1, unitPrice: -1 }] });
    ok(PUR.replacePoItemsSchema, { items: [{ ingredientId: ID, quantityOrdered: 1, unitPrice: '' }] });
    ko(PUR.createReceptionVoucherSchema, { items: [{ poItemId: ID, quantityReceived: 1, unitPrice: -1 }] });
  });

  it('4. frais annexes d\'un BC : montant négatif refusé', () => {
    const base = { items: [{ itemId: ID, quantityDelivered: 1 }] };
    ko(PUR.confirmDeliverySchema, { ...base, extraFees: [{ label: 'Remise', amount: -50 }] }, /facture d'avoir/);
    ko(PUR.confirmDeliverySchema, { ...base, extraFees: [{ label: 'Remise', amount: '-50' }] });
    ok(PUR.confirmDeliverySchema, { ...base, extraFees: [{ label: 'Transport', amount: 80 }] });
    ok(PUR.confirmDeliverySchema, { ...base, extraFees: [{ label: '', amount: null }] });
  });

  it('5. transfert de produits : négatif refusé, ligne à 0 ignorée, toutes à 0 refusé', () => {
    const S = chain(productTransferSchema, productTransferRulesSchema);
    const head = { fromStoreId: ID, toStoreId: ID2 };
    ko(S, { ...head, items: [{ productId: ID, quantity: -1 }] }, /Quantité négative/);
    ko(S, { ...head, items: [{ productId: ID, quantity: 0 }, { productId: ID2, quantity: '' }] }, /Toutes les lignes sont à 0/);
    ok(S, { ...head, items: [{ productId: ID, quantity: 0 }, { productId: ID2, quantity: 4 }] });
    ok(S, { ...head, items: [] }); // liste vide : « Ajoutez au moins une ligne » du dépôt
  });

  it('7. réception d\'un transfert de production : qtyReceived < 0 refusé', () => {
    ko(PROD.receiveProductionTransferSchema, { items: [{ itemId: ID, qtyReceived: -1 }] }, /négative/);
    ok(PROD.receiveProductionTransferSchema, { items: [{ itemId: ID, qtyReceived: 0 }] });
    ok(PROD.receiveProductionTransferSchema, { items: [{ itemId: ID, qtyReceived: '12.000' }] });
  });

  it('8. contrôle d\'ouverture : quantités < 0 refusées', () => {
    const S = chain(openingCheckSchema, openingCheckRulesSchema);
    ko(S, { items: [{ productId: ID, expectedQty: 3, foundQty: -1 }] }, /constatée négative/);
    ko(S, { items: [{ productId: ID, expectedQty: -2, foundQty: 0 }] }, /attendue négative/);
    ok(S, { items: [{ productId: ID, expectedQty: 3, foundQty: 0, missingReason: 'theft' }] });
  });

  it('9. règlement client et imputation d\'avoir : montant ≤ 0 refusé', () => {
    const rec = { customerId: ID, paymentMethod: 'cash', paymentDate: '2026-11-18' };
    ko(PAY.customerReceiptSchema, { ...rec, amount: 0 }, /supérieur à 0/);
    ko(PAY.customerReceiptSchema, { ...rec, amount: -10 }, /supérieur à 0/);
    ko(PAY.customerReceiptSchema, { ...rec, amount: 100, allocations: [{ invoiceId: ID, amount: -5 }] });
    ok(PAY.customerReceiptSchema, { ...rec, amount: 100, allocations: [{ invoiceId: ID, amount: 0 }, { invoiceId: ID2, amount: 60 }] });
    ko(PAY.allocateReceiptSchema, { invoiceId: ID, amount: 0 }, /supérieur à 0/);
    ok(PAY.allocateReceiptSchema, { invoiceId: ID });
    ok(PAY.allocateReceiptSchema, { invoiceId: ID, amount: 25 });
    ko(PAY.applyCreditSchema, { creditNoteId: ID, amount: -1 }, /supérieur à 0/);
    ok(PAY.applyCreditSchema, { creditNoteId: ID });
    ok(PAY.applyCreditSchema, { creditNoteId: ID, amount: '40.5' });
  });

  it('10. litige et créance douteuse : montant ≤ 0 refusé dans le schéma', () => {
    ko(PAY.openDisputeSchema, { reason: 'Casse', disputedAmount: 0 }, /supérieur à 0/);
    ko(PAY.openDisputeSchema, { reason: 'Casse', disputedAmount: -20 }, /supérieur à 0/);
    ok(PAY.openDisputeSchema, { reason: 'Casse', disputedAmount: 20 });
    ko(PAY.classifyBadDebtSchema, { status: 'doubtful', amount: 0 }, /supérieur à 0/);
    ko(PAY.classifyBadDebtSchema, { status: 'doubtful', amount: '-3' });
    ok(PAY.classifyBadDebtSchema, { status: 'doubtful', amount: null }); // = tout le reste dû
    ok(PAY.classifyBadDebtSchema, { status: 'written_off', amount: '150.5' });
  });

  it('11. contrôle des ventes : quantités et prix unitaire < 0 refusés', () => {
    ko(PAY.reconUpsertLineSchema, { productName: 'Tarte', approQty: -1 });
    ko(PAY.reconUpsertLineSchema, { productName: 'Tarte', unitPrice: -2 });
    ok(PAY.reconUpsertLineSchema, { productName: 'Tarte', approQty: 0, unitPrice: 0, recuQty: '' });
    ko(PAY.reconUpdateLineSchema, { venduQty: -3 });
    ok(PAY.reconUpdateLineSchema, { venduQty: 3, invenduQty: null });
    ko(PAY.reconBulkApproSchema, { rows: [{ productName: 'Tarte', approQty: -1 }] });
    ko(PAY.reconImportSalesSchema, { items: [{ productName: 'Tarte', quantity: -1, unitPrice: 5 }] });
    ok(PAY.reconImportSalesSchema, { items: [{ productName: 'Tarte', quantity: 2, unitPrice: 5, netSales: -1 }] });
    ko(PAY.reconFicheSchema, { lines: [{ productName: 'Tarte', slotQty: { 1: -4 } }] });
    ok(PAY.reconFicheSchema, { lines: [{ productName: 'Tarte', slotQty: { 1: 4, 2: '' }, totalQty: 4 }] });
    ko(PAY.reconProductSchema, { productName: 'Tarte', unitPrice: -1 });
  });

  it('12. relevé bancaire manuel : soldes négatifs admis, montant de ligne ≥ 0, sens in | out', () => {
    const st = { label: 'Relevé', accountCode: '5141', statementDate: '2026-11-30' };
    ok(PAY.bankStatementSchema, { ...st, openingBalance: -1200, closingBalance: -50, lines: [{ operationDate: '2026-11-03', amount: 150, direction: 'out' }] });
    ok(PAY.bankStatementSchema, { ...st, lines: [{ operationDate: '2026-11-03', amount: 0 }, { operationDate: '2026-11-04', amount: 10 }] });
    ko(PAY.bankStatementSchema, { ...st, lines: [{ operationDate: '2026-11-03', amount: -150 }] }, /négatif/);
    ko(PAY.bankStatementSchema, { ...st, lines: [{ operationDate: '2026-11-03', amount: 150, direction: 'debit' }] }, /in ou out/);
    ok(PAY.bankStatementSchema, { ...st, lines: [{ operationDate: '2026-11-03', amount: 150, direction: '' }] });
  });

  it('13. paramètres de production : pourcentages bornés', () => {
    // chargesFixesPct est une fraction (0,40 = 40 %) : borne 0..1.
    ko(PROD.productionSettingsSchema, { chargesFixesPct: 1.2 });
    ok(PROD.productionSettingsSchema, { chargesFixesPct: 0.4 });
    ko(PROD.productionSettingsSchema, { overproductionPct: -5 });
    ko(PROD.productionSettingsSchema, { markupPercent: 1500 });
    ok(PROD.productionSettingsSchema, { chargesFixesPct: 1, overproductionPct: 100, markupPercent: 999.99 });
    ko(PROD.productionSettingsSchema, { markupPercent: 1000 }); // DECIMAL(5,2)
    ok(PROD.productionSettingsSchema, { chargesFixesPct: '', markupPercent: null, stepsEnabled: true });
  });

  it('15. bon de sortie generate : storeId facultatif', () => {
    ok(PROD.generateBonBody, { planId: ID });
    ok(PROD.generateBonBody, { planId: ID, storeId: ID2 });
    ko(PROD.generateBonBody, { storeId: ID2 });
  });

  it('16. échéancier : seuls pending et cancelled se posent à la main (partial / paid recalculés par la base)', () => {
    for (const status of ['pending', 'cancelled']) ok(PAY.scheduledPaymentUpdateSchema, { status });
    for (const status of ['partial', 'paid']) ko(PAY.scheduledPaymentUpdateSchema, { status }, /Statut d'échéance invalide/);
    ko(PAY.scheduledPaymentUpdateSchema, { status: 'annule' }, /Statut d'échéance invalide/);
    ok(PAY.scheduledPaymentUpdateSchema, { amountDue: 120 });
  });
});

describe('stock-frigo.controller : auteur du mouvement (hors liste)', () => {
  it('passe user.userId au dépôt (et non user.id, toujours vide)', async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
    const { stockFrigoController } = await import('../../controllers/stock-frigo.controller.js');
    const { stockFrigoRepository } = await import('../../repositories/stock-frigo.repository.js');
    const spy = vi.spyOn(stockFrigoRepository, 'adjust').mockResolvedValue(undefined as never);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    await stockFrigoController.adjust({ params: { id: ID }, body: { quantity: 2 }, user: { userId: ID2, storeId: ID } } as never, res as never);
    expect(spy).toHaveBeenCalledWith(ID, 2, ID2, undefined);
    spy.mockRestore();
  });
});

describe.skipIf(!hasTestDb)('6. Ajustement manuel d\'emballage — base de test', () => {
  let fx: Fixtures;
  let packagingId: string;
  let repo: typeof import('../../repositories/packaging-item.repository.js')['packagingItemRepository'];
  let dbPool: { end: () => Promise<void> };
  const p = () => testPool();
  const stock = async () => parseFloat((await p().query(
    `SELECT stock_quantity FROM packaging_store_stock WHERE packaging_id = $1 AND store_id = $2`, [packagingId, fx.storeId])).rows[0]?.stock_quantity ?? '0');
  const moves = async () => Number((await p().query(
    `SELECT COUNT(*) AS n FROM packaging_stock_transactions WHERE packaging_id = $1`, [packagingId])).rows[0].n);

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
    repo = (await import('../../repositories/packaging-item.repository.js')).packagingItemRepository;
    dbPool = (await import('../../config/database.js')).db.pool;
    fx = await createBaseFixtures();
    packagingId = (await p().query(
      `INSERT INTO packaging_items (name, unit, unit_cost, category) VALUES ($1, 'piece', 0.2, 'autre') RETURNING id`, [`Boîte règle 6 ${RUN}`])).rows[0].id;
    await p().query(`INSERT INTO packaging_store_stock (packaging_id, store_id, stock_quantity) VALUES ($1, $2, 5)`, [packagingId, fx.storeId]);
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM stock_anomalies WHERE item_id = $1`, [packagingId]).catch(() => undefined);
    await p().query(`DELETE FROM packaging_stock_transactions WHERE packaging_id = $1`, [packagingId]).catch(() => undefined);
    await p().query(`DELETE FROM packaging_store_stock WHERE packaging_id = $1`, [packagingId]).catch(() => undefined);
    await p().query(`DELETE FROM packaging_items WHERE id = $1`, [packagingId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await dbPool?.end().catch(() => undefined);
    await closeTestPool();
  });

  it('diminution supérieure au stock : 400 « Stock insuffisant : 5 disponibles », rien écrit', async () => {
    const before = await moves();
    await expect(repo.adjustStockManual({ packagingId, storeId: fx.storeId, change: -8, type: 'waste', performedBy: fx.userId }))
      .rejects.toMatchObject({ statusCode: 400, message: 'Stock insuffisant : 5 disponibles' });
    expect(await stock()).toBe(5);
    expect(await moves()).toBe(before);
  });

  it('diminution dans la limite du stock et entrée : admises', async () => {
    expect(await repo.adjustStockManual({ packagingId, storeId: fx.storeId, change: -5, type: 'waste', performedBy: fx.userId })).toBe(0);
    expect(await repo.adjustStockManual({ packagingId, storeId: fx.storeId, change: 3, type: 'reception', performedBy: fx.userId })).toBe(3);
    expect(await stock()).toBe(3);
  });

  it('article sans ligne de stock : toute diminution refusée (0 disponible)', async () => {
    const other = (await p().query(
      `INSERT INTO packaging_items (name, unit, unit_cost, category) VALUES ($1, 'piece', 0.1, 'autre') RETURNING id`, [`Sachet règle 6 ${RUN}`])).rows[0].id;
    try {
      await expect(repo.adjustStockManual({ packagingId: other, storeId: fx.storeId, change: -1, type: 'adjustment' }))
        .rejects.toMatchObject({ statusCode: 400, message: 'Stock insuffisant : 0 disponibles' });
    } finally {
      await p().query(`DELETE FROM packaging_items WHERE id = $1`, [other]).catch(() => undefined);
    }
  });
});
