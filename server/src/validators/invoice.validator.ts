import { z } from 'zod';

/**
 * G0-07 (plan d'action 2026-11) — charges utiles des factures (création,
 * modification, fusion de bons de commande). Avant : aucun schéma, le corps de la
 * requête allait tel quel au dépôt de données.
 *
 * Les écrans envoient des champs vides ('') pour « non renseigné » et parfois des
 * nombres en texte : les deux sont ramenés à leur forme propre, pas refusés.
 * Les clés inconnues sont retirées (dont `creditNote`, réservé à la route des
 * avoirs, et `createdBy` / `storeId`, posés par le serveur).
 */
const blank = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : v);
const blankNull = (v: unknown) => (v === '' || v === undefined ? null : v);

const uuid = z.string().guid('Identifiant invalide');
const optUuid = z.preprocess(blank, uuid.optional());
const nullableUuid = z.preprocess(blankNull, uuid.nullable()).optional();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue : AAAA-MM-JJ')
  .refine(s => !Number.isNaN(Date.parse(s)), 'Date invalide');
const optDate = z.preprocess(blank, isoDate.optional());
const nullableDate = z.preprocess(blankNull, isoDate.nullable()).optional();

const MAX_AMOUNT = 1_000_000_000;
const money = z.coerce.number({ error: 'Montant invalide' }).finite().min(0, 'Montant négatif refusé').max(MAX_AMOUNT);
const optMoney = z.preprocess(blank, money.optional());

const optText = (max: number) => z.preprocess(blank, z.string().trim().max(max).optional());
const nullableText = (max: number) => z.preprocess(blankNull, z.string().trim().max(max).nullable()).optional();

const invoiceItemSchema = z.object({
  productId: optUuid,
  ingredientId: optUuid,
  description: optText(500),
  quantity: z.coerce.number().finite().positive('Quantité attendue > 0').max(10_000_000),
  unitPrice: money,
  subtotal: money,
  // Le taux doit en plus appartenir au référentiel des codes TVA (vérifié en base).
  tvaRate: z.preprocess(blankNull, z.coerce.number().min(0).max(100).nullable()).optional(),
  deliveryNoteItemId: nullableUuid,
  orderItemId: nullableUuid,
  creditedItemId: nullableUuid,
});

/** L'échéance ne précède pas la date de la facture. */
const datesCoherent = (d: { invoiceDate?: string; dueDate?: string | null }) =>
  !d.invoiceDate || !d.dueDate || d.dueDate >= d.invoiceDate;
const DATES_MESSAGE = { message: 'L\'échéance ne peut pas précéder la date de la facture', path: ['dueDate'] };

export const createInvoiceSchema = z.object({
  invoiceNumber: optText(100),
  invoiceType: z.preprocess(blank, z.enum(['received', 'emitted']).optional()),
  supplierId: optUuid,
  customerId: optUuid,
  categoryId: optUuid,
  purchaseOrderId: optUuid,
  receptionVoucherId: optUuid,
  orderId: optUuid,
  invoiceDate: isoDate,
  dueDate: optDate,
  amount: money,
  taxAmount: optMoney,
  totalAmount: optMoney,
  notes: optText(2000),
  expectedPaymentMode: optText(40),
  receptionDate: optDate,
  checkNumber: optText(60),
  items: z.array(invoiceItemSchema).max(500).optional(),
  currencyCode: z.preprocess(blankNull, z.string().trim().length(3).toUpperCase().nullable()).optional(),
  exchangeRate: z.preprocess(blankNull, z.coerce.number().positive().max(100000).nullable()).optional(),
}).refine(datesCoherent, DATES_MESSAGE);

export const updateInvoiceSchema = z.object({
  invoiceNumber: optText(100),
  supplierId: nullableUuid,
  customerId: nullableUuid,
  categoryId: nullableUuid,
  invoiceDate: optDate,
  dueDate: nullableDate,
  amount: optMoney,
  taxAmount: optMoney,
  totalAmount: optMoney,
  notes: nullableText(2000),
  expectedPaymentMode: nullableText(40),
  receptionDate: nullableDate,
  checkNumber: nullableText(60),
}).refine(datesCoherent, DATES_MESSAGE);

export const mergeInvoicesSchema = z.object({
  purchaseOrderIds: z.array(uuid).min(2, 'Sélectionnez au moins 2 bons de commande').max(100),
  supplierInvoiceNumber: optText(100),
  invoiceDate: optDate,
});

/** Taux de TVA portés par les lignes d'une charge validée. */
export function tvaRatesOf(body: { items?: { tvaRate?: number | null }[] }): number[] {
  return [...new Set((body.items ?? []).map(i => i.tvaRate).filter((r): r is number => r != null))];
}
