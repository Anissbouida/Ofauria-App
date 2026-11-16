/**
 * G0-07 — schémas des factures, du stock et de la caisse : ce qui est refusé, et
 * ce qui doit continuer de passer (champs vides et nombres en texte des écrans).
 */
import { describe, it, expect } from 'vitest';
import { createInvoiceSchema, updateInvoiceSchema, mergeInvoicesSchema, tvaRatesOf } from '../validators/invoice.validator.js';
import { restockSchema, adjustStockSchema, stockThresholdSchema } from '../validators/stock.validator.js';
import { openRegisterSchema, submitRegisterAmountSchema } from '../validators/cash-register.validator.js';

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const base = { invoiceDate: '2026-11-10', amount: 100, supplierId: ID };

describe('Facture — création (G0-07)', () => {
  it('accepte ce que les écrans envoient : champs vides et nombres en texte', () => {
    const r = createInvoiceSchema.safeParse({
      ...base, amount: '100.50', taxAmount: '', dueDate: '', customerId: '', notes: '', invoiceType: 'received',
      items: [{ description: 'Farine', quantity: '2', unitPrice: '50.25', subtotal: 100.5, tvaRate: '20', ingredientId: ID2 }],
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.amount).toBe(100.5);
    expect(r.data.taxAmount).toBeUndefined();
    expect(r.data.dueDate).toBeUndefined();
    expect(r.data.items?.[0]).toMatchObject({ quantity: 2, unitPrice: 50.25, tvaRate: 20 });
  });

  it('refuse les montants négatifs, les dates incohérentes et les identifiants invalides', () => {
    expect(createInvoiceSchema.safeParse({ ...base, amount: -1 }).success).toBe(false);
    expect(createInvoiceSchema.safeParse({ ...base, taxAmount: -5 }).success).toBe(false);
    expect(createInvoiceSchema.safeParse({ ...base, amount: 'abc' }).success).toBe(false);
    expect(createInvoiceSchema.safeParse({ ...base, invoiceDate: '10/11/2026' }).success).toBe(false);
    expect(createInvoiceSchema.safeParse({ ...base, dueDate: '2026-11-01' }).success).toBe(false); // avant la facture
    expect(createInvoiceSchema.safeParse({ ...base, supplierId: 'x' }).success).toBe(false);
    expect(createInvoiceSchema.safeParse({ ...base, invoiceType: 'autre' }).success).toBe(false);
    expect(createInvoiceSchema.safeParse({ ...base, items: [{ quantity: 0, unitPrice: 1, subtotal: 0 }] }).success).toBe(false);
    expect(createInvoiceSchema.safeParse({ ...base, items: [{ quantity: 1, unitPrice: 1, subtotal: 1, tvaRate: 150 }] }).success).toBe(false);
    expect(createInvoiceSchema.safeParse({ amount: 10 }).success).toBe(false); // date obligatoire
  });

  it('retire les clés réservées au serveur', () => {
    const r = createInvoiceSchema.parse({ ...base, createdBy: ID2, storeId: ID2, creditNote: { creditedInvoiceId: ID2, reason: 'price' } }) as Record<string, unknown>;
    expect(r.createdBy).toBeUndefined();
    expect(r.storeId).toBeUndefined();
    expect(r.creditNote).toBeUndefined();
  });

  it('liste les taux de TVA des lignes', () => {
    expect(tvaRatesOf({ items: [{ tvaRate: 20 }, { tvaRate: 20 }, { tvaRate: null }, { tvaRate: 10 }, {}] }).sort()).toEqual([10, 20]);
    expect(tvaRatesOf({})).toEqual([]);
  });
});

describe('Facture — modification et fusion (G0-07)', () => {
  it('une valeur vide efface le champ, un montant négatif est refusé', () => {
    const r = updateInvoiceSchema.parse({ dueDate: '', supplierId: '', notes: '', amount: '120' });
    expect(r.dueDate).toBeNull();
    expect(r.supplierId).toBeNull();
    expect(r.amount).toBe(120);
    expect(updateInvoiceSchema.safeParse({ amount: -3 }).success).toBe(false);
    expect(updateInvoiceSchema.safeParse({ invoiceDate: '2026-11-10', dueDate: '2026-10-01' }).success).toBe(false);
    expect(updateInvoiceSchema.safeParse({}).success).toBe(true);
  });

  it('la fusion exige au moins deux bons de commande valides', () => {
    expect(mergeInvoicesSchema.safeParse({ purchaseOrderIds: [ID, ID2] }).success).toBe(true);
    expect(mergeInvoicesSchema.safeParse({ purchaseOrderIds: [ID] }).success).toBe(false);
    expect(mergeInvoicesSchema.safeParse({ purchaseOrderIds: [ID, 'x'] }).success).toBe(false);
    expect(mergeInvoicesSchema.safeParse({}).success).toBe(false);
  });
});

describe('Stock et caisse (G0-07)', () => {
  it('entrée de stock : quantité strictement positive', () => {
    expect(restockSchema.safeParse({ ingredientId: ID, quantity: '5', expirationDate: '' }).success).toBe(true);
    expect(restockSchema.safeParse({ ingredientId: ID, quantity: 0 }).success).toBe(false);
    expect(restockSchema.safeParse({ ingredientId: 'x', quantity: 1 }).success).toBe(false);
  });

  it('ajustement : quantité signée, type dans la liste, clés inconnues conservées', () => {
    const r = adjustStockSchema.parse({ ingredientId: ID, quantity: '-2.5', type: 'waste', reasonCode: 'casse', lotId: ID2 }) as Record<string, unknown>;
    expect(r.quantity).toBe(-2.5);
    expect(r.lotId).toBe(ID2);
    expect(adjustStockSchema.safeParse({ ingredientId: ID, quantity: 'abc' }).success).toBe(false);
    expect(adjustStockSchema.safeParse({ ingredientId: ID, quantity: 1, type: 'vol' }).success).toBe(false);
  });

  it('seuil et montants de caisse : jamais négatifs', () => {
    expect(stockThresholdSchema.safeParse({ ingredientId: ID, threshold: -1 }).success).toBe(false);
    expect(stockThresholdSchema.safeParse({ ingredientId: ID, threshold: '3' }).success).toBe(true);
    expect(openRegisterSchema.safeParse({}).success).toBe(true);
    expect(openRegisterSchema.safeParse({ openingAmount: -10 }).success).toBe(false);
    expect(submitRegisterAmountSchema.safeParse({ actualAmount: '1250.50', actualCardAmount: '' }).success).toBe(true);
    expect(submitRegisterAmountSchema.safeParse({ actualAmount: -1 }).success).toBe(false);
    expect(submitRegisterAmountSchema.safeParse({ notes: 'x' }).success).toBe(false); // montant obligatoire
  });
});
