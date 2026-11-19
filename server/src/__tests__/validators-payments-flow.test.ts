/**
 * Plan pilote — étape 2, lot paiements / règlements / rapprochement : les corps que le client
 * envoie réellement passent (relevés dans client/src : accounting.api, ledger.api, withholding.api,
 * reconciliation.api, EcheancierView, ReceivablesTab, EmittedInvoicesTab, PurchasingPage,
 * ReconciliationPage…), les champs non déclarés sont conservés, les corps incohérents refusés.
 */
import { describe, it, expect } from 'vitest';
import * as S from '../validators/payments-flow.validator.js';
import { emptyBody } from '../validators/common.validator.js';

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
type Schema = { safeParse: (v: unknown) => { success: boolean; data?: unknown } };
const ok = (schema: Schema, v: unknown) => expect(schema.safeParse(v).success).toBe(true);
const ko = (schema: Schema, v: unknown) => expect(schema.safeParse(v).success).toBe(false);
const data = (schema: Schema, v: unknown) => schema.safeParse(v).data as Record<string, any>;

describe('Schémas paiements et rapprochement (plan pilote, étape 2)', () => {
  it('factures : catégorie, lignes, conditions, statut', () => {
    ok(S.invoiceCategorySchema, { categoryId: null });
    ok(S.invoiceCategorySchema, { categoryId: ID });
    ko(S.invoiceCategorySchema, { categoryId: 'abc' });
    ok(S.invoiceLineCategorySchema, { categoryId: ID, source: 'reception_item' });
    // PurchasingPage / EmittedInvoicesTab : nombres, taux null, liens de rapprochement conservés.
    const r = data(S.replaceInvoiceItemsSchema, { items: [
      { ingredientId: null, description: 'Farine', quantity: 2, unitPrice: 10.5, subtotal: 21, tvaRate: null, purchaseOrderItemId: ID, extra: 1 },
      { productId: '', description: null, quantity: '3', unitPrice: '4,5', tvaRate: '' },
    ] });
    expect(r.items[0].extra).toBe(1);
    expect(r.items[0].purchaseOrderItemId).toBe(ID);
    ok(S.replaceInvoiceItemsSchema, {});
    ko(S.replaceInvoiceItemsSchema, { items: [{ quantity: 'beaucoup' }] });
    ok(S.invoicePaymentTermsSchema, { dueDate: '2026-12-01', expectedPaymentMode: 'check', receptionDate: null });
    ok(S.invoicePaymentTermsSchema, { dueDate: '' });
    ko(S.invoicePaymentTermsSchema, { dueDate: 'demain' });
    ok(S.invoiceStatusSchema, { status: 'disputed' });
    ko(S.invoiceStatusSchema, { status: 12 });
  });

  it('factures : litiges, créances douteuses, échéancier, annulation', () => {
    ok(S.openDisputeSchema, { reason: 'Livraison incomplète', disputedAmount: 120 });
    ok(S.openDisputeSchema, { reason: 'x', disputedAmount: null });
    ko(S.openDisputeSchema, { reason: 'x', disputedAmount: 'trop' });
    ok(S.resolveDisputeSchema, { resolution: 'Avoir émis', creditNoteId: undefined });
    ok(S.resolveDisputeSchema, { resolution: 'Avoir émis', creditNoteId: ID });
    ok(S.rejectDisputeSchema, { resolution: 'Non fondé' });
    ok(S.classifyBadDebtSchema, { status: 'doubtful', reason: undefined });
    ok(S.classifyBadDebtSchema, { status: 'written_off', amount: '150.5' });
    ok(S.invoiceScheduleSchema, { installments: 3, firstDueDate: '2026-12-01', intervalMonths: 1, expectedPaymentMode: null });
    ko(S.invoiceScheduleSchema, { installments: 3, firstDueDate: '01/12/2026x' });
    ok(S.cancelInvoiceSchema, {});
    ok(S.cancelInvoiceSchema, { reasonCodeId: ID, note: 'Doublon' });
    ko(S.cancelInvoiceSchema, { reasonCodeId: 'doublon' });
  });

  it('factures : avoirs et imputation', () => {
    ok(S.createCreditNoteSchema, { reason: 'return', note: undefined, lines: [{ invoiceItemId: ID, quantity: 2 }] });
    ok(S.createCreditNoteSchema, { reason: 'price', lines: [{ invoiceItemId: ID, amount: 12.5 }] });
    ko(S.createCreditNoteSchema, { reason: 'price', lines: [{ invoiceItemId: 'x', amount: 12.5 }] });
    ko(S.createCreditNoteSchema, { reason: 'price', lines: [{ invoiceItemId: ID, amount: 'douze' }] });
    ok(S.applyCreditSchema, { creditNoteId: ID });
    ok(S.applyCreditSchema, { creditNoteId: ID, amount: 30 });
    ko(S.applyCreditSchema, { creditNoteId: ID, amount: 'tout' });
  });

  it('paiements : chèques et encaissements clients', () => {
    ok(S.markCashedSchema, { cashedAt: '2026-11-18' });
    ok(S.markCashedSchema, { cashedAt: '2026-11-18', note: 'Remise 12' });
    ko(S.markCashedSchema, { cashedAt: 'hier' });
    ok(emptyBody, undefined);
    // ReceivablesTab : règlement réparti, chèque avec numéro.
    ok(S.customerReceiptSchema, {
      customerId: ID, amount: 300, paymentMethod: 'check', paymentDate: '2026-11-18', reference: undefined,
      description: 'Règlement Client', checkNumber: '0012', checkDate: undefined,
      allocations: [{ invoiceId: ID2, amount: 200 }],
    });
    ko(S.customerReceiptSchema, { customerId: ID, amount: 300, paymentMethod: 'cash', paymentDate: '2026-11-18', allocations: [{ invoiceId: 'f', amount: 1 }] });
    ok(S.allocateReceiptSchema, { invoiceId: ID });
    ko(S.allocateReceiptSchema, { invoiceId: 'x' });
  });

  it('échéancier, dettes, charges fixes : null / vide gardent leur sens', () => {
    const u = data(S.scheduledPaymentUpdateSchema, { amountDue: null, notes: null });
    expect(u.amountDue).toBeNull();
    ok(S.scheduledPaymentUpdateSchema, { amountDue: 120.5, dueDate: '2026-12-05', status: 'cancelled' });
    ko(S.scheduledPaymentUpdateSchema, { dueDate: null });
    ok(S.createDebtSchema, {
      label: 'Four', totalAmount: 12000, installments: 12, firstDueDate: '2026-12-01', intervalMonths: 1,
      supplierId: null, categoryId: null, expectedPaymentMode: null,
    });
    ok(S.createDebtSchema, { label: 'Four', totalAmount: '12000', installments: '12', firstDueDate: '2026-12-01', supplierId: '' });
    ko(S.createDebtSchema, { label: 'Four', totalAmount: 12000, supplierId: 'fournisseur' });
    ok(S.updateDebtSchema, { status: 'cancelled' });
    const charge = { label: 'Loyer', categoryId: ID, supplierId: null, amount: null, intervalMonths: 1, dueDay: 5, startDate: '2026-11-01', endDate: null, expectedPaymentMode: null };
    ok(S.createRecurringChargeSchema, charge);
    ok(S.updateRecurringChargeSchema, charge);
    ok(S.updateRecurringChargeSchema, { isActive: false });
    ko(S.updateRecurringChargeSchema, { isActive: 'non' });
    expect(data(S.updateRecurringChargeSchema, { endDate: '' }).endDate).toBe('');
  });

  it('retenues à la source', () => {
    ok(S.withholdingTypeSchema, { rate: null });
    ok(S.withholdingTypeSchema, { threshold: 5000 });
    ok(S.withholdingTypeSchema, { isActive: true });
    ko(S.withholdingTypeSchema, { rate: 'dix' });
    ok(S.withholdingRemitSchema, { typeCode: 'ras_tva', amount: 1500, date: '2026-11-18', method: 'bank' });
    ko(S.withholdingRemitSchema, { typeCode: 'ras_tva', amount: 1500, date: 'novembre' });
  });

  it('rapprochement bancaire', () => {
    ok(S.bankStatementSchema, {
      label: 'Relevé novembre', accountCode: '5141', statementDate: '2026-11-30', openingBalance: -1200, closingBalance: 3400,
      lines: [{ operationDate: '2026-11-03', label: 'VIR', reference: undefined, amount: 150, direction: 'in' }],
    });
    ko(S.bankStatementSchema, { label: 'R', accountCode: '5141', statementDate: '2026-11-30', lines: [{ operationDate: '2026-11-03', amount: 'cent' }] });
    ok(S.bankMatchSchema, { entryLineId: ID });
    ko(S.bankMatchSchema, { entryLineId: 'ligne' });
  });

  it('contrôle des ventes', () => {
    ok(S.reconOpenDaySchema, { date: '2026-11-18' });
    ok(S.reconCloseSchema, { force: false });
    ko(S.reconCloseSchema, { force: 'oui' });
    ok(S.reconUpsertLineSchema, { productName: 'Tarte', sku: undefined, category: undefined, approQty: 0, recuQty: 0, unitPrice: 12 });
    ok(S.reconUpdateLineSchema, { recuQty: 4.5 });
    ko(S.reconUpdateLineSchema, { recuQty: 'quatre' });
    ok(S.reconBulkApproSchema, { rows: [{ productName: 'Pain', approQty: 35, unitPrice: 3.5, sku: 'PAIN' }] });
    ok(S.reconImportSalesSchema, { items: [{ sku: '', productName: 'Pain', category: 'Boulangerie', quantity: 3, netSales: 10.5 }] });
    ko(S.reconImportSalesSchema, { items: [{ productName: 'Pain', quantity: 'trois' }] });
    ok(S.reconSlotSchema, { id: undefined, category: 'Viennoiserie', slotNumber: 1, label: 'Matin', targetTime: null, defaultPct: 40, sortOrder: 0 });
    ok(S.reconSlotSchema, { id: ID, category: 'V', label: 'S', slotNumber: '2' });
    ok(S.reconCarryOverSchema, { category: 'Pain', enabled: true });
    ok(S.reconProductSchema, { productName: 'Tarte', category: undefined, unitPrice: 0 });
    ok(S.reconBulkProductsSchema, { rows: [{ sku: undefined, productName: 'Tarte', category: undefined, unitPrice: undefined }] });
    ok(S.reconDarijaSchema, { productKey: 'TARTE', darija: '' });
    ok(S.reconFicheSchema, { date: '2026-11-19', lines: [{ productName: 'Tarte', slotQty: { 1: 4, 2: 0 }, totalQty: 4, removed: false }] });
    ko(S.reconFicheSchema, { date: '2026-11-19', lines: [{ productName: 'Tarte', removed: 'oui' }] });
  });

  it('grand livre : période, activation, saisie libre', () => {
    ok(S.fiscalPeriodStatusSchema, { status: 'open', note: 'Correction' });
    ok(S.fiscalPeriodStatusSchema, { status: 'closed', note: undefined });
    ok(S.activeFlagSchema, { active: false });
    ko(S.activeFlagSchema, { active: 'oui' });
    const entry = {
      journalCode: 'OD', date: '2026-11-18', description: 'Régularisation', pieceRef: null, pieceDate: null,
      lines: [{ accountId: ID, auxiliaryId: null, debit: 100, credit: 0, label: null }, { accountId: ID2, debit: 0, credit: '100' }],
    };
    ok(S.manualEntrySchema, entry);
    ko(S.manualEntrySchema, { ...entry, lines: [entry.lines[0]] });
    ko(S.manualEntrySchema, { ...entry, lines: [{ ...entry.lines[0], debit: -5 }, entry.lines[1]] });
    ko(S.manualEntrySchema, { ...entry, date: '18/11/2026' });
  });

  it('actions sans corps', () => {
    ok(emptyBody, undefined);
    ok(emptyBody, {});
  });
});
