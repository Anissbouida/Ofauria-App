/**
 * Plan pilote — étape 2, lot caisse et ventes : les corps que le client envoie réellement passent
 * (relevés dans client/src : OrderFormModal, POSPage, OrdersPage, delivery-notes.api, unsold-decision.api…),
 * les champs non déclarés sont conservés (passthrough), et les corps incohérents sont refusés.
 */
import { describe, it, expect } from 'vitest';
import * as S from '../validators/sales-flow.validator.js';
import { emptyBody } from '../validators/common.validator.js';

const ID = '11111111-1111-4111-8111-111111111111';
const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => expect(schema.safeParse(v).success).toBe(true);
const ko = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) => expect(schema.safeParse(v).success).toBe(false);

describe('Schémas caisse et ventes (plan pilote, étape 2)', () => {
  it('commande : corps du formulaire accepté, champs inconnus conservés', () => {
    const body = {
      type: 'custom', pickupDate: '2026-11-20', orderDate: '2026-11-18', paymentMethod: 'cash', discountPct: 0, advanceAmount: 50,
      items: [{ productId: ID, quantity: 2, unitPrice: 12.5, tvaRate: 20 }], customerName: 'Mme Test', customerPhone: '0600000000',
    };
    const r = S.createOrderSchema.safeParse(body);
    expect(r.success).toBe(true);
    expect((r as unknown as { data: { items: { tvaRate: number }[] } }).data.items[0].tvaRate).toBe(20);
    ok(S.updateOrderSchema, { ...body, orderDate: undefined, customerId: ID });
    ko(S.createOrderSchema, { ...body, items: [] });
    ko(S.createOrderSchema, { ...body, items: [{ productId: ID, quantity: 0 }] });
    ko(S.createOrderSchema, { ...body, discountPct: 120 });
  });

  it('commande : statut, report, remise, acompte', () => {
    ok(S.orderStatusSchema, { status: 'cancelled' });
    ko(S.orderStatusSchema, {});
    ok(S.rescheduleOrderSchema, { newPickupDate: '2026-11-20T12:00:00', reason: undefined });
    ok(S.deliverOrderSchema, { amountPaid: 12.5, paymentMethod: 'cash' });
    ko(S.deliverOrderSchema, { amountPaid: -1, paymentMethod: 'cash' });
    ok(S.prepaymentInvoiceSchema, { percent: 30 });
    ok(S.prepaymentInvoiceSchema, { amount: '150' });
  });

  it('bons de livraison', () => {
    const line = { productId: ID, quantity: 3, unitPrice: 4.2, tvaRate: '' };
    ok(S.createDeliveryNoteSchema, { customerId: ID, items: [line], deliveryDate: '2026-11-18' });
    ko(S.createDeliveryNoteSchema, { customerId: ID, items: [{ ...line, unitPrice: -1 }] });
    ko(S.createDeliveryNoteSchema, { customerId: ID, items: [] });
    ok(S.createPreparedDeliveryNoteSchema, { customerId: ID, items: [{ description: 'Plateau', quantity: 1, unitPrice: 0 }] });
    ok(S.deliveryNoteFromOrderSchema, {});
    ok(S.deliveryNoteFromOrderSchema, { quantities: { [ID]: 0 }, closeRemainder: true });
    ko(S.deliveryNoteFromOrderSchema, { quantities: { [ID]: -2 } });
    ok(S.shipDeliveryNoteSchema, {});
    ok(S.deliverDeliveryNoteSchema, { receivedByName: 'M. X', signature: 'data:image/png;base64,AAAA' });
    ok(S.invoiceDeliveryNotesSchema, { deliveryNoteIds: [ID], invoiceDate: '2026-11-18' });
    ko(S.invoiceDeliveryNotesSchema, { deliveryNoteIds: [] });
  });

  it('tickets, retours, invendus, report de caisse', () => {
    ok(S.cancelSaleSchema, { reason: 'Erreur de saisie' });
    ko(S.cancelSaleSchema, { reason: ' ' });
    ok(S.invoiceSaleSchema, { customerId: '' });
    ok(S.importSalesSchema, { days: [{ date: '2026-11-18', items: [{ sku: 'A1', productName: 'Pain', quantity: 3, unitPrice: 1.5, netSales: 4.5, costOfGoods: 1 }] }] });
    ko(S.importSalesSchema, { days: [] });
    ok(S.createProReturnSchema, { customerId: ID, items: [{ productId: ID, quantity: 1, unitPrice: 2, decision: 'scrap' }] });
    ok(S.saveUnsoldDecisionsSchema, { sessionId: ID, closeType: 'passation', decisions: [] });
    ok(S.saveUnsoldDecisionsSchema, { sessionId: ID, closeType: 'fin_journee', decisions: [{ productId: ID, initialQty: 10, soldQty: 7, remainingQty: 3, finalDestination: 'waste', saleType: 'unit' }] });
    ok(S.destroyExpiredSchema, { items: [{ productId: ID, quantity: 2, reason: 'DLC', productName: 'Tarte' }] });
    ok(S.reportOverrideSchema, { year: '2026', month: '10', cashNet: '1200.50', cardCumul: 300 });
    ko(S.reportOverrideSchema, { year: 2026, month: 13, cashNet: 1, cardCumul: 1 });
  });

  it('action sans corps : corps absent ou objet', () => {
    ok(emptyBody, undefined);
    ok(emptyBody, {});
  });
});
