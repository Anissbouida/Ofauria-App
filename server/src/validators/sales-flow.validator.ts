import { z } from 'zod';
import { uuid, optUuid, optDate, optText, optMoney, money, positiveQty, optNonNegQty, optPct, tvaRate, optBool } from './common.validator.js';

/**
 * Plan pilote — étape 2, lot caisse et ventes (G0-07 ciblé). Chaque schéma reprend ce que le
 * contrôleur et le dépôt lisent et vérifient déjà (voir le commentaire de chaque bloc) ; les
 * messages métier détaillés restent ceux du code (champ facultatif ici quand le contrôleur
 * renvoie lui-même un message clair s'il manque).
 */

/* ─── Tickets de caisse ──────────────────────────────────────────────────── */
// sale.repository.cancel : motif d'au moins 3 caractères.
export const cancelSaleSchema = z.object({ reason: z.string().trim().min(3, 'Motif d\'annulation requis (3 caractères au moins)').max(500) }).passthrough();
// sale.controller.invoice : client facultatif (ticket anonyme).
export const invoiceSaleSchema = z.object({ customerId: optUuid }).passthrough();
// sale.repository.importDailySales : contrôle lui-même quantités et prix (liste des lignes refusées).
export const importSalesSchema = z.object({
  days: z.array(z.object({
    date: z.string().trim().min(8, 'Date requise'),
    items: z.array(z.object({
      sku: optText(80), productName: z.string().trim().max(300),
      quantity: z.coerce.number().finite(), unitPrice: z.coerce.number().finite(),
      netSales: z.coerce.number().finite().optional(), costOfGoods: z.coerce.number().finite().optional(),
    }).passthrough()).max(5000),
  }).passthrough()).min(1, 'Données manquantes').max(400),
}).passthrough();

/* ─── Caisse : report de solde (correction d'historique, admin) ─────────── */
// accounting.controller.saveReportOverride : année, mois 1-12, deux nombres finis.
export const reportOverrideSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  cashNet: z.coerce.number().finite('cashNet doit être un nombre'),
  cardCumul: z.coerce.number().finite('cardCumul doit être un nombre'),
  note: optText(500),
}).passthrough();

/* ─── Bons de livraison ──────────────────────────────────────────────────── */
// delivery-note.repository.create / createPrepared : au moins une ligne, quantité > 0, prix ≥ 0,
// produit ou désignation (contrôlé par le dépôt).
const deliveryLine = z.object({
  productId: optUuid, description: optText(500), orderItemId: optUuid,
  quantity: positiveQty, unitPrice: money, tvaRate,
}).passthrough();
const creditOverrideReason = optText(500);
export const createDeliveryNoteSchema = z.object({
  customerId: uuid, deliveryDate: optDate, orderId: optUuid, notes: optText(2000),
  items: z.array(deliveryLine).min(1, 'Ajoutez au moins une ligne').max(500),
  shippingStoreId: optUuid, receivedByName: optText(200), creditOverrideReason,
}).passthrough();
export const createPreparedDeliveryNoteSchema = z.object({
  customerId: uuid, deliveryDate: optDate, orderId: optUuid, notes: optText(2000),
  items: z.array(deliveryLine).min(1, 'Ajoutez au moins une ligne').max(500),
  shippingStoreId: optUuid, shipAddress: optText(1000),
}).passthrough();
// createFromOrder : quantités par ligne de commande (0 = non livrée), reliquat soldé ou non.
export const deliveryNoteFromOrderSchema = z.object({
  quantities: z.record(z.string(), z.coerce.number().finite().min(0, 'Quantité négative')).optional(),
  receivedByName: optText(200), deliveryDate: optDate, notes: optText(2000), closeRemainder: optBool, creditOverrideReason,
}).passthrough();
export const shipDeliveryNoteSchema = z.object({ closeRemainder: optBool, creditOverrideReason }).passthrough();
// Signature manuscrite = image en data URI : borne large.
export const deliverDeliveryNoteSchema = z.object({
  receivedByName: optText(200), signature: z.string().max(2_000_000).nullish(), reserves: optText(2000), deliveredAt: optDate,
}).passthrough();
// delivery-note.repository.invoice : au moins un bon.
export const invoiceDeliveryNotesSchema = z.object({
  deliveryNoteIds: z.array(uuid).min(1, 'Choisissez au moins un bon de livraison').max(500), invoiceDate: optDate,
}).passthrough();

/* ─── Commandes ──────────────────────────────────────────────────────────── */
// order.controller.priceLines : produit, quantité > 0, prix saisi ≥ 0 ou vide (prix grille) ;
// remises, plafonds par rôle et dérogations de prix restent contrôlés par le contrôleur.
const orderLine = z.object({
  productId: uuid, quantity: positiveQty,
  unitPrice: z.preprocess(v => (v === '' || v === null ? undefined : v), z.coerce.number().finite().min(0, 'Prix négatif').optional()),
  notes: optText(1000),
}).passthrough();
const orderBody = {
  customerId: optUuid, customerName: optText(200), customerPhone: optText(40), type: optText(30),
  items: z.array(orderLine).min(1, 'Ajoutez au moins un produit').max(300),
  notes: optText(2000), pickupDate: optDate, discountPct: optPct, discountAmount: optMoney, priceOverrideReason: optText(500),
};
export const createOrderSchema = z.object({
  ...orderBody, orderDate: optDate, paymentMethod: optText(20), advanceAmount: optMoney, deferPayment: optBool, channelId: optUuid,
}).passthrough();
export const updateOrderSchema = z.object(orderBody).passthrough();
// updateStatus : la liste des statuts permis et le message « completed » restent dans le contrôleur.
export const orderStatusSchema = z.object({ status: z.string().trim().min(1, 'Statut requis').max(30), reason: optText(500) }).passthrough();
// reschedule : date future et motif < 24 h contrôlés par le contrôleur.
export const rescheduleOrderSchema = z.object({ newPickupDate: optDate, reason: optText(500) }).passthrough();
// deliver : solde intégral et caisse ouverte contrôlés par le contrôleur.
export const deliverOrderSchema = z.object({ amountPaid: optMoney, paymentMethod: optText(20) }).passthrough();
// prepaymentInvoice : pourcentage ou montant (l'un des deux, contrôlé par le contrôleur).
export const prepaymentInvoiceSchema = z.object({ percent: optPct, amount: optMoney }).passthrough();

/* ─── Retours professionnels ─────────────────────────────────────────────── */
// pro-return.controller.create : client requis (message du contrôleur), lignes contrôlées par le dépôt.
export const createProReturnSchema = z.object({
  customerId: optUuid, deliveryNoteId: optUuid, storeId: optUuid, notes: optText(2000), creditedInvoiceId: optUuid,
  items: z.array(z.object({
    productId: uuid, productLotId: optUuid, deliveryNoteItemId: optUuid, quantity: positiveQty, unitPrice: optMoney,
    decision: z.enum(['restock', 'scrap']).optional(),
  }).passthrough()).max(500).optional(),
}).passthrough();

/* ─── Invendus (fin de journée / passation) ─────────────────────────────── */
// unsold-decision.controller.save : liste requise, session et règles de clôture contrôlées par le contrôleur.
export const saveUnsoldDecisionsSchema = z.object({
  sessionId: optUuid, closeType: optText(30), notes: optText(2000),
  decisions: z.array(z.object({
    productId: optUuid, initialQty: optNonNegQty, soldQty: optNonNegQty, remainingQty: optNonNegQty,
    finalDestination: optText(30), discrepancyMotif: optText(500),
  }).passthrough()).max(2000),
}).passthrough();
// destroyExpired : au moins un produit (message du contrôleur si vide).
export const destroyExpiredSchema = z.object({
  items: z.array(z.object({ productId: uuid, productName: optText(300), quantity: positiveQty }).passthrough()).max(2000).optional(),
}).passthrough();
