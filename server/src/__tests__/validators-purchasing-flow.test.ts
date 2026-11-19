/**
 * Plan pilote — étape 2, lot achats / réceptions / réapprovisionnement / paie : les corps que le
 * client envoie réellement passent (relevés dans client/src : purchase-orders.api, PurchaseOrdersTab
 * (réception, édition du BC), replenishment.api, ReplenishmentPage, RequestDetailPage, POSPage,
 * employees.api), les champs non déclarés sont conservés (passthrough), et les corps incohérents
 * sont refusés.
 */
import { describe, it, expect } from 'vitest';
import * as P from '../validators/purchasing-flow.validator.js';
import { ebdsSchema } from '../validators/payroll-flow.validator.js';
import { emptyBody } from '../validators/common.validator.js';

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
type Parser = { safeParse: (v: unknown) => { success: boolean; data?: unknown } };
const ok = (schema: Parser, v: unknown) => expect(schema.safeParse(v).success).toBe(true);
const ko = (schema: Parser, v: unknown) => expect(schema.safeParse(v).success).toBe(false);
const parsed = <T>(schema: Parser, v: unknown) => schema.safeParse(v).data as T;

describe('Schémas achats et réceptions (plan pilote, étape 2)', () => {
  it('envoi du BC : {} ou { budgetAck }, sans corps accepté', () => {
    ok(P.sendPurchaseOrderSchema, {});
    ok(P.sendPurchaseOrderSchema, undefined);
    ok(P.sendPurchaseOrderSchema, { budgetAck: true });
    ok(P.sendPurchaseOrderSchema, { urgencyReason: 'Rupture de farine' });
    ko(P.sendPurchaseOrderSchema, { urgencyReason: 42 });
  });

  it('confirmation de livraison : corps de PurchaseOrdersTab accepté, nombres convertis', () => {
    const body = {
      items: [
        { itemId: ID, quantityDelivered: 12.5, unitPrice: 9.8, supplierLotNumber: 'L-24', expirationDate: '2026-12-01', manufacturedDate: '',
          grossWeight: 13, tareWeight: null, netWeight: 13 },
        { itemId: ID2, quantityDelivered: 0 },
      ],
      supplierInvoiceNumber: 'FA-2026-118', supplierInvoiceDate: '2026-11-18', forceComplete: true,
      extraFees: [{ label: 'Transport', amount: 150, categoryId: null }],
      clientExtra: 'conservé',
    };
    const r = parsed<{ items: { quantityDelivered: number }[]; clientExtra: string }>(P.confirmDeliverySchema, body);
    expect(r.clientExtra).toBe('conservé');
    expect(r.items[1].quantityDelivered).toBe(0);
    ok(P.confirmDeliverySchema, { items: [{ itemId: ID, quantityDelivered: '3' }] });
    // Liste vide : le contrôleur répond lui-même « Articles livrés requis ».
    ok(P.confirmDeliverySchema, { items: [] });
    ko(P.confirmDeliverySchema, { items: [{ itemId: 'pas-un-id', quantityDelivered: 1 }] });
    ko(P.confirmDeliverySchema, { items: [{ itemId: ID, quantityDelivered: 'abc' }] });
    ko(P.confirmDeliverySchema, { items: [{ itemId: ID, quantityDelivered: 1, expirationDate: '2026-13-45' }] });
    ko(P.confirmDeliverySchema, { items: 'tout' });
  });

  it('prix tardifs, en-tête et lignes du BC', () => {
    ok(P.updatePoPricesSchema, { items: [{ itemId: ID, unitPrice: 12 }] });
    ko(P.updatePoPricesSchema, { items: [{ itemId: ID, unitPrice: 'douze' }] });

    // En-tête : null conservé (= effacer la date), fournisseur absent = inchangé.
    const h = parsed<{ expectedDeliveryDate: unknown; supplierId?: string }>(P.updatePoHeaderSchema, { supplierId: undefined, expectedDeliveryDate: null, notes: null });
    expect(h.expectedDeliveryDate).toBeNull();
    ok(P.updatePoHeaderSchema, { supplierId: ID, expectedDeliveryDate: '2026-11-25', notes: 'Livrer le matin' });
    ko(P.updatePoHeaderSchema, { supplierId: 'x' });

    const lines = [
      { id: ID, ingredientId: ID2, packagingId: null, quantityOrdered: 10, quantityDelivered: 0, unitPrice: null },
      { id: undefined, ingredientId: null, packagingId: ID2, quantityOrdered: 2.5, quantityDelivered: 0, unitPrice: 4.75 },
    ];
    const r = parsed<{ items: { packagingId: unknown; unitPrice: unknown }[] }>(P.replacePoItemsSchema, { items: lines });
    expect(r.items[0].packagingId).toBeNull();
    expect(r.items[0].unitPrice).toBeNull();
    ok(P.replacePoItemsSchema, { items: [{ ...lines[0], unitPrice: '' }] });
    ko(P.replacePoItemsSchema, { items: [{ ...lines[0], quantityOrdered: 'dix' }] });
    ko(P.replacePoItemsSchema, { items: [{ ...lines[0], lineType: 'autre' }] });
  });

  it('bon de réception direct et décision sur écart de prix', () => {
    ok(P.createReceptionVoucherSchema, { purchaseOrderId: ID, notes: 'RAS', items: [{ poItemId: ID2, ingredientId: ID, quantityReceived: 5, unitPrice: null }] });
    ok(P.createReceptionVoucherSchema, { purchaseOrderId: ID, items: [{ poItemId: ID2, quantityReceived: 0 }] });
    ko(P.createReceptionVoucherSchema, { purchaseOrderId: 'BC-12', items: [] });
    ko(P.createReceptionVoucherSchema, { purchaseOrderId: ID, items: [{ poItemId: ID2, quantityReceived: 'cinq' }] });

    ok(P.priceDecisionSchema, { decision: 'approved', note: undefined });
    ok(P.priceDecisionSchema, { decision: 'rejected', note: 'Prix hors contrat' });
    ko(P.priceDecisionSchema, { decision: 'maybe' });
    ko(P.priceDecisionSchema, {});
  });

  it('soumission de DA, génération de facture : sans corps', () => {
    ok(emptyBody, undefined);
    ok(emptyBody, {});
  });
});

describe('Schémas réapprovisionnement boutique (plan pilote, étape 2)', () => {
  it('vérification et création (ReplenishmentPage, POSPage)', () => {
    ok(P.replenishmentCheckItemsSchema, { productIds: [ID, ID2] });
    ok(P.replenishmentCheckItemsSchema, { productIds: [] });
    ko(P.replenishmentCheckItemsSchema, { productIds: ['abc'] });

    ok(P.createReplenishmentSchema, { priority: 'normal', notes: undefined, items: [{ productId: ID, requestedQuantity: 6 }] });
    ok(P.createReplenishmentSchema, { priority: 'urgent', notes: 'Pour midi', items: [{ productId: ID, requestedQuantity: 6, suggestedQuantity: undefined }, { productId: ID2, requestedQuantity: 3, suggestedQuantity: 4 }] });
    ko(P.createReplenishmentSchema, { priority: 'normal', items: [{ productId: 'croissant', requestedQuantity: 6 }] });
    ko(P.createReplenishmentSchema, { priority: 'normal', items: [{ productId: ID, requestedQuantity: 'six' }] });
  });

  it('préparation, réception (quantité 0 admise), inventaire', () => {
    // requested_quantity relu de la base peut arriver en texte (« 6.000 »).
    ok(P.prepareReplenishmentSchema, { items: [{ itemId: ID, qtyToStore: '6.000', qtyToStock: 0, source: 'stock' }] });
    ko(P.prepareReplenishmentSchema, { items: [{ itemId: ID, qtyToStore: 'x', qtyToStock: 0, source: 'stock' }] });

    ok(P.confirmReplenishmentReceptionSchema, { items: [{ itemId: ID, qtyReceived: 0, notes: undefined }, { itemId: ID2, qtyReceived: 4, notes: 'Une cassée' }] });
    ko(P.confirmReplenishmentReceptionSchema, { items: [{ itemId: ID }] });

    const inv = { sessionId: ID, notes: '', items: [{ productId: ID2, productName: 'Croissant', replenishedQty: '10', soldQty: 7, remainingQty: 3, destination: 'waste' }] };
    const r = parsed<{ items: { replenishedQty: number }[] }>(P.replenishmentInventoryCheckSchema, inv);
    expect(r.items[0].replenishedQty).toBe(10);
    ko(P.replenishmentInventoryCheckSchema, { items: [{ productId: ID2, replenishedQty: 1, soldQty: 'beaucoup', remainingQty: 0 }] });
  });
});

describe('Schémas paie (plan pilote, étape 2)', () => {
  it('annulation de paiement : sans corps', () => {
    ok(emptyBody, undefined);
  });

  it('e-BDS : champs multipart en texte', () => {
    const r = parsed<{ month: number; year: number }>(ebdsSchema, { month: '10', year: '2026' });
    expect(r).toMatchObject({ month: 10, year: 2026 });
    // Champ manquant : le contrôleur répond « month et year requis ».
    ok(ebdsSchema, {});
    ok(ebdsSchema, undefined);
    ko(ebdsSchema, { month: 'octobre', year: '2026' });
    ko(ebdsSchema, { month: '10', year: '2026.5' });
  });
});
