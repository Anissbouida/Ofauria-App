import { z } from 'zod';
import { uuid, optUuid, optDate, dateLike, optText, optNumber } from './common.validator.js';

/**
 * Plan pilote — étape 2, lot paiements / règlements / rapprochement (G0-07 ciblé).
 *
 * Même règle que le lot caisse et ventes : chaque schéma reprend les TYPES et les règles que le
 * contrôleur ou le dépôt appliquent déjà (voir le commentaire de chaque bloc). Quand le contrôleur
 * renvoie lui-même un message clair pour un champ manquant, le champ reste facultatif ici. Les
 * bornes métier (montant > 0, reste à imputer, quantité créditable…) restent celles du dépôt.
 *
 * Deux briques locales gardent la valeur brute, parce que le contrôleur distingue « absent »
 * (undefined = ne pas toucher), « vide » ('' ou null = effacer) et une valeur :
 *  - rawNum : nombre, texte numérique, '' ou null — le contrôleur convertit lui-même ;
 *  - rawId  : UUID, '' ou null — le contrôleur fait `|| null`.
 */
const rawNum = z.union([
  z.null(), z.literal(''), z.number().finite('Nombre invalide'),
  z.string().trim().max(40).refine(v => Number.isFinite(parseFloat(v)), 'Nombre invalide'),
]).optional();
const rawId = z.union([uuid, z.literal(''), z.null()]).optional();
const rawDate = z.union([dateLike, z.literal(''), z.null()]).optional();
const str = (max: number) => z.string().max(max, `Texte trop long (${max} caractères au plus)`);

/* ─── Factures : catégorie, lignes, conditions, statut ───────────────────── */
// invoiceController.updateCategory : categoryId ?? null (null = retirer la catégorie).
export const invoiceCategorySchema = z.object({ categoryId: z.union([uuid, z.null()]).optional() }).passthrough();
// updateLineCategory : source 'reception_item' ou, à défaut, ligne de facture.
export const invoiceLineCategorySchema = z.object({
  categoryId: z.union([uuid, z.null()]).optional(), source: str(40).optional(),
}).passthrough();
// replaceItems : le contrôleur exige le tableau (message clair) et convertit lui-même les nombres
// (invalide → 0) ; taux vide = TVA d'en-tête ; liens de rapprochement conservés (deux graphies).
const replaceItemLine = z.object({
  productId: rawId, ingredientId: rawId, description: str(2000).nullish(),
  quantity: rawNum, unitPrice: rawNum, subtotal: rawNum, tvaRate: rawNum,
  purchaseOrderItemId: rawId, purchase_order_item_id: rawId,
  receptionVoucherItemId: rawId, reception_voucher_item_id: rawId,
}).passthrough();
export const replaceInvoiceItemsSchema = z.object({ items: z.array(replaceItemLine).max(1000, 'Trop de lignes').optional() }).passthrough();
// updatePaymentTerms : '' ou null efface la date / le mode ; le mode est vérifié par le contrôleur.
export const invoicePaymentTermsSchema = z.object({
  dueDate: rawDate, receptionDate: rawDate, expectedPaymentMode: str(50).nullish(),
}).passthrough();
// updateStatusManual : seuls « litige » et « recalcul depuis les paiements » passent (contrôleur).
export const invoiceStatusSchema = z.object({ status: str(30).optional() }).passthrough();

/* ─── Factures : litiges, créances douteuses ─────────────────────────────── */
// invoiceController.openDispute : motif requis (message du contrôleur) ; le dépôt borne le montant
// au reste dû et refuse ≤ 0. null accepté : le client envoie Number('') ou NaN sérialisé en null.
export const openDisputeSchema = z.object({
  reason: str(2000).optional(), disputedAmount: rawNum, responsibleUserId: rawId, targetDate: rawDate,
}).passthrough();
export const resolveDisputeSchema = z.object({ resolution: str(2000).nullish(), creditNoteId: rawId }).passthrough();
export const rejectDisputeSchema = z.object({ resolution: str(2000).nullish() }).passthrough();
// classifyBadDebt : statut contrôlé par le contrôleur ; montant borné au reste par le dépôt.
export const classifyBadDebtSchema = z.object({ status: str(30).optional(), reason: str(2000).nullish(), amount: rawNum }).passthrough();

/* ─── Factures : échéancier, annulation, avoirs ──────────────────────────── */
// paymentScheduleController.createInvoiceSchedule : nombre d'échéances 1-120 et date de première
// échéance contrôlés par le contrôleur (messages clairs).
export const invoiceScheduleSchema = z.object({
  installments: rawNum, firstDueDate: rawDate, intervalMonths: rawNum, amount: rawNum,
  expectedPaymentMode: str(50).nullish(), notes: str(2000).nullish(),
}).passthrough();
// invoiceController.cancel : motif (référentiel) exigé par le contrôleur pour une facture reçue.
export const cancelInvoiceSchema = z.object({ reasonCodeId: rawId, note: str(1000).nullish() }).passthrough();
// createCreditNote : motif contrôlé par le contrôleur ; lignes (quantité ou montant) bornées par le dépôt.
export const createCreditNoteSchema = z.object({
  reason: str(30).optional(),
  lines: z.array(z.object({ invoiceItemId: uuid, quantity: optNumber, amount: optNumber }).passthrough()).max(1000).optional(),
  date: optDate, note: str(1000).nullish(),
}).passthrough();
// applyCredit : avoir requis (message du contrôleur) ; montant facultatif = tout ce qui reste.
export const applyCreditSchema = z.object({ creditNoteId: optUuid, amount: optNumber }).passthrough();

/* ─── Paiements : chèques, encaissements clients ─────────────────────────── */
// paymentController.markCashed : date de débit facultative (aujourd'hui par défaut), note libre.
export const markCashedSchema = z.object({ cashedAt: optDate, note: optText(1000) }).passthrough();
// createCustomerReceipt : client, mode et date exigés par le contrôleur ; montant > 0, affectations
// sans doublon et ≤ règlement, n° de chèque/effet : contrôlés par le dépôt.
export const customerReceiptSchema = z.object({
  customerId: optUuid, amount: optNumber, paymentMethod: str(50).optional(), paymentDate: optDate,
  reference: optText(100), checkNumber: optText(100), checkDate: optDate, treasuryAccountId: optUuid,
  description: optText(1000),
  allocations: z.array(z.object({ invoiceId: uuid, amount: optNumber }).passthrough()).max(500).optional(),
}).passthrough();
// allocateCustomerReceipt : facture requise (message du contrôleur) ; montant facultatif.
export const allocateReceiptSchema = z.object({ invoiceId: optUuid, amount: optNumber }).passthrough();

/* ─── Échéancier, dettes, charges fixes ──────────────────────────────────── */
// paymentScheduleController.update : amountDue null/'' = montant variable non renseigné.
export const scheduledPaymentUpdateSchema = z.object({
  amountDue: rawNum, dueDate: dateLike.optional(), notes: str(2000).nullish(),
  expectedPaymentMode: str(50).nullish(), status: str(20).optional(),
}).passthrough();
// createDebt : libellé, montant > 0, 1-120 échéances et première date contrôlés par le contrôleur.
export const createDebtSchema = z.object({
  label: str(300).optional(), totalAmount: rawNum, installments: rawNum, firstDueDate: rawDate,
  intervalMonths: rawNum, supplierId: rawId, categoryId: rawId, fixedAssetId: rawId, startDate: rawDate,
  expectedPaymentMode: str(50).nullish(), notes: str(2000).nullish(),
}).passthrough();
// updateDebt : statut active/cancelled contrôlé par le contrôleur.
export const updateDebtSchema = z.object({ status: str(20).optional() }).passthrough();
// createRecurring / updateRecurring : libellé, catégorie, jour 1-31 et périodicité 1-12 contrôlés
// par le contrôleur ; montant null/'' = charge variable.
const recurringBody = {
  label: str(300).optional(), categoryId: rawId, supplierId: rawId, amount: rawNum,
  intervalMonths: rawNum, dueDay: rawNum, startDate: rawDate, endDate: rawDate,
  expectedPaymentMode: str(50).nullish(), notes: str(2000).nullish(),
};
export const createRecurringChargeSchema = z.object(recurringBody).passthrough();
export const updateRecurringChargeSchema = z.object({ ...recurringBody, isActive: z.boolean().optional() }).passthrough();

/* ─── Retenues à la source ───────────────────────────────────────────────── */
// withholdingController.updateType : null efface le taux / le seuil.
export const withholdingTypeSchema = z.object({
  rate: rawNum, threshold: rawNum, rateAbove: rawNum, base: str(30).optional(), echeanceJours: rawNum,
  isActive: z.boolean().optional(), notes: str(2000).nullish(),
}).passthrough();
// reversement : type, montant et date exigés par le contrôleur ; montant > 0 contrôlé par le dépôt.
export const withholdingRemitSchema = z.object({
  typeCode: str(30).optional(), amount: optNumber, date: optDate, method: str(20).optional(),
}).passthrough();

/* ─── Rapprochement bancaire ─────────────────────────────────────────────── */
// bankReconciliationController.createStatement : libellé, compte, date et tableau de lignes exigés
// par le contrôleur ; les lignes de montant ≤ 0 sont ignorées par le dépôt ; sens 'out' ou 'in'.
// Date d'opération : texte seulement (Postgres l'interprète, format non imposé par le code).
export const bankStatementSchema = z.object({
  label: str(200).optional(), accountCode: str(20).optional(), statementDate: optDate,
  openingBalance: optNumber, closingBalance: optNumber,
  lines: z.array(z.object({
    operationDate: str(40), label: optText(500), reference: optText(200), amount: optNumber, direction: str(10).optional(),
  }).passthrough()).max(10000, 'Trop de lignes').optional(),
}).passthrough();
// matchLine : ligne d'écriture exigée par le contrôleur (message clair).
export const bankMatchSchema = z.object({ entryLineId: optUuid }).passthrough();

/* ─── Contrôle des ventes (module isolé) ─────────────────────────────────── */
// reconciliationController : date AAAA-MM-JJ, nom produit, catégorie… exigés par le contrôleur ;
// les quantités vides valent « non saisi » (num → undefined), comme optNumber.
export const reconOpenDaySchema = z.object({ date: str(10).optional() }).passthrough();
export const reconCloseSchema = z.object({ force: z.boolean().optional() }).passthrough();
const reconText = (max: number) => str(max).nullish();
export const reconUpsertLineSchema = z.object({
  productName: str(300).optional(), sku: reconText(100), category: reconText(200),
  approQty: optNumber, recuQty: optNumber, invenduQty: optNumber, unitPrice: optNumber,
}).passthrough();
export const reconUpdateLineSchema = z.object({
  approQty: optNumber, recuQty: optNumber, venduQty: optNumber, invenduQty: optNumber, unitPrice: optNumber,
}).passthrough();
// Lots : le dépôt ignore les lignes sans nom produit (et, à l'import des ventes, quantité ≤ 0).
const reconRow = { sku: reconText(100), productName: reconText(300), category: reconText(200), unitPrice: optNumber };
export const reconBulkApproSchema = z.object({
  rows: z.array(z.object({ ...reconRow, approQty: optNumber }).passthrough()).max(5000, 'Trop de lignes').optional(),
}).passthrough();
export const reconImportSalesSchema = z.object({
  items: z.array(z.object({ ...reconRow, quantity: optNumber, netSales: optNumber }).passthrough()).max(5000, 'Trop de lignes').optional(),
}).passthrough();
export const reconSlotSchema = z.object({
  id: optUuid, category: str(200).optional(), label: str(200).optional(), targetTime: reconText(10),
  slotNumber: optNumber, defaultPct: optNumber, sortOrder: optNumber,
}).passthrough();
export const reconCarryOverSchema = z.object({ category: str(200).optional(), enabled: z.boolean().optional() }).passthrough();
export const reconProductSchema = z.object({
  id: optUuid, productName: str(300).optional(), sku: reconText(100), category: reconText(200), unitPrice: optNumber,
}).passthrough();
export const reconBulkProductsSchema = z.object({
  rows: z.array(z.object(reconRow).passthrough()).max(5000, 'Trop de lignes').optional(),
}).passthrough();
export const reconDarijaSchema = z.object({ productKey: str(300).optional(), darija: str(500).nullish() }).passthrough();
export const reconFicheSchema = z.object({
  date: str(10).optional(),
  lines: z.array(z.object({
    ...reconRow, totalQty: optNumber, removed: z.boolean().optional(),
    slotQty: z.record(z.string(), z.union([z.number(), z.string(), z.null()])).nullish(),
  }).passthrough()).max(5000, 'Trop de lignes').optional(),
}).passthrough();

/* ─── Grand livre ────────────────────────────────────────────────────────── */
// fiscalPeriodController.updateStatus : statut open/closed/locked contrôlé par le contrôleur ;
// motif de réouverture (3 caractères) contrôlé par le dépôt.
export const fiscalPeriodStatusSchema = z.object({ status: str(20).optional(), note: optText(1000) }).passthrough();
// Activer / désactiver un compte ou un modèle : Boolean(active), absent = désactiver.
export const activeFlagSchema = z.object({ active: z.boolean().optional() }).passthrough();
// Saisie libre (mig 418) : mêmes règles que la validation déjà faite dans la route (parseManual).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const manualEntrySchema = z.object({
  journalCode: z.string().trim().min(1, 'Journal requis').max(10),
  date: z.string().regex(DATE_RE, 'Date attendue AAAA-MM-JJ'),
  description: z.string().trim().min(1, 'Libellé requis').max(2000),
  pieceRef: z.string().trim().max(60).nullish(),
  pieceDate: z.string().regex(DATE_RE, 'Date de pièce attendue AAAA-MM-JJ').nullish(),
  lines: z.array(z.object({
    accountId: z.string().uuid('Compte invalide'),
    auxiliaryId: z.string().uuid('Compte auxiliaire invalide').nullish(),
    debit: z.coerce.number().min(0, 'Débit négatif'),
    credit: z.coerce.number().min(0, 'Crédit négatif'),
    label: z.string().trim().max(200).nullish(),
  }).passthrough()).min(2, 'Deux lignes au moins').max(500, 'Trop de lignes'),
}).passthrough();
