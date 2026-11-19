import { z } from 'zod';
import { uuid, optUuid, optDate, dateLike, optText, optNumber, optNonNegQty } from './common.validator.js';

/**
 * Plan pilote — étape 2, lot achats / réceptions / réapprovisionnement (G0-07 ciblé).
 * Chaque schéma reprend les TYPES que le contrôleur et le dépôt lisent déjà (voir le
 * commentaire de chaque bloc) ; aucune règle métier nouvelle. Quand le contrôleur renvoie
 * lui-même un message clair si un champ manque (« Articles livrés requis »…), le champ reste
 * facultatif ici. Les quantités et prix sont convertis en nombre : le dépôt les additionne
 * (une chaîne y serait concaténée) et les passe à Postgres.
 */

/** Nombre fini, requis (texte de formulaire converti). */
const num = (label: string) => z.coerce.number({ invalid_type_error: `${label} invalide` }).finite(`${label} invalide`);
/** Nombre fini ou null ; chaîne vide = null. */
const nullableNum = (label: string) =>
  z.preprocess(v => (v === '' ? null : v), z.union([z.null(), z.coerce.number({ invalid_type_error: `${label} invalide` }).finite(`${label} invalide`)]).optional());
/** Quantité ≥ 0, requise (règle pilote 2026-11 : un négatif est refusé, plus ignoré ni reporté). */
const nonNegNum = (label: string) => num(label).min(0, `${label} négative : saisissez une quantité positive ou 0`);
/** Prix ≥ 0 ou null (règle pilote 2026-11 : 0 = gratuité admise, négatif refusé). */
const nullablePrice = (label: string) =>
  z.preprocess(v => (v === '' ? null : v), z.union([z.null(), z.coerce.number({ invalid_type_error: `${label} invalide` }).finite(`${label} invalide`)
    .min(0, `${label} négatif : un prix d'achat ne peut pas être inférieur à 0`)]).optional());
/** Identifiant facultatif qui garde null (le contrôleur distingue null et absent, ou fait `?? null`). */
const nullableUuid = z.preprocess(v => (v === '' ? null : v), uuid.nullable().optional());
/** Date facultative, null conservé (null = effacer la date). */
const nullableDate = z.preprocess(v => (v === '' ? null : v), dateLike.nullable().optional());

/* ─── Bon de commande : envoi ─────────────────────────────────────────────── */
// purchase-order.controller.send : lit urgencyReason (texte, ≥ 5 caractères exigés par le contrôleur
// seulement en mode « block ») et budgetAck (=== true). Le client n'envoie que { budgetAck } ou {}.
export const sendPurchaseOrderSchema = z.preprocess(v => v ?? {}, z.object({
  budgetAck: z.boolean().optional(),
  urgencyReason: z.string().max(2000).nullish(),
}).passthrough());

/* ─── Bon de commande : confirmation de livraison (réception) ─────────────── */
// controller.confirmDelivery → repository.confirmDelivery → receptionVoucherRepository.create.
// Règles pilote 2026-11 : une ligne à quantité 0 reste ignorée par le dépôt (filtre > 0), une
// quantité négative est refusée (400) ; prix négatif refusé, 0 admis. unitPrice absent/null = prix du BC. Lot, DLC, fabrication : chaîne vide = absent (`|| null`).
const deliveryLine = z.object({
  itemId: uuid,
  quantityDelivered: nonNegNum('Quantité livrée'),
  unitPrice: nullablePrice('Prix unitaire'),
  supplierLotNumber: z.string().max(200).nullish(),
  expirationDate: optDate,
  manufacturedDate: optDate,
  grossWeight: nullableNum('Poids brut'),
  tareWeight: nullableNum('Tare'),
  netWeight: nullableNum('Poids net'),
}).passthrough();
// Frais annexes : le contrôleur filtre lui-même (libellé non vide, montant fini ≠ 0, Number(amount)).
// Règle pilote 2026-11 : un montant négatif est refusé (un avoir passe par une facture d'avoir).
const extraFee = z.object({
  label: z.string().max(300).nullish(),
  amount: z.union([z.number(), z.string()]).nullish()
    .refine(v => v == null || v === '' || !(Number(v) < 0), 'Frais annexe négatif : un avoir fournisseur passe par une facture d\'avoir'),
  categoryId: nullableUuid,
}).passthrough();
export const confirmDeliverySchema = z.object({
  // Le contrôleur répond « Articles livrés requis » si la liste est vide ou absente.
  items: z.array(deliveryLine).max(1000).optional(),
  supplierInvoiceNumber: z.string().max(100).nullish(),
  supplierInvoiceDate: optDate,
  forceComplete: z.boolean().nullish(),
  extraFees: z.array(extraFee).max(100).nullish(),
}).passthrough();

/* ─── Bon de commande : saisie tardive des prix ───────────────────────────── */
// repository.updateItemPrices : UPDATE unit_price = $1 par ligne (itemId). Le contrôleur répond
// « Articles avec prix requis » si la liste est vide.
export const updatePoPricesSchema = z.object({
  items: z.array(z.object({ itemId: uuid, unitPrice: nullablePrice('Prix unitaire') }).passthrough()).max(1000).optional(),
}).passthrough();

/* ─── Bon de commande : en-tête (PUT /:id) ────────────────────────────────── */
// repository.updateHeader : champ absent = inchangé ; date et notes vides ou null = effacées.
export const updatePoHeaderSchema = z.object({
  supplierId: optUuid,
  expectedDeliveryDate: nullableDate,
  notes: z.string().max(2000).nullish(),
}).passthrough();

/* ─── Bon de commande : remplacement des lignes (PUT /:id/items) ──────────── */
// controller.replaceItems : refuse lui-même une ligne sans article (ou désignation + catégorie)
// ou à quantité ≤ 0 ; prix vide/null = sans prix. quantityDelivered absent = inchangé.
// Règles pilote 2026-11 : quantityDelivered < 0 et prix < 0 refusés (400).
const replaceLine = z.object({
  id: optUuid,
  ingredientId: nullableUuid,
  packagingId: nullableUuid,
  lineType: z.enum(['ingredient', 'consumable', 'service', 'asset']).nullish(),
  description: z.string().max(500).nullish(),
  categoryId: nullableUuid,
  unit: z.string().max(20).nullish(),
  quantityOrdered: num('Quantité commandée'),
  quantityDelivered: optNonNegQty,
  unitPrice: nullablePrice('Prix unitaire'),
}).passthrough();
export const replacePoItemsSchema = z.object({
  // Le contrôleur répond « Champ "items" requis (tableau) » s'il manque.
  items: z.array(replaceLine).max(500).optional(),
}).passthrough();

/* ─── Bon de réception direct (POST /reception-vouchers) ──────────────────── */
// controller.create → receptionVoucherRepository.create : lignes à quantité 0 ignorées ; règles
// pilote 2026-11 : quantité négative et prix négatif refusés (400).
// Le contrôleur répond « Bon de commande et articles requis » si l'un manque.
const receptionLine = z.object({
  poItemId: uuid,
  ingredientId: nullableUuid,
  packagingId: nullableUuid,
  quantityReceived: nonNegNum('Quantité reçue'),
  unitPrice: nullablePrice('Prix unitaire'),
  notes: z.string().max(2000).nullish(),
  supplierLotNumber: z.string().max(200).nullish(),
  expirationDate: optDate,
  manufacturedDate: optDate,
  grossWeight: nullableNum('Poids brut'),
  tareWeight: nullableNum('Tare'),
  netWeight: nullableNum('Poids net'),
}).passthrough();
export const createReceptionVoucherSchema = z.object({
  purchaseOrderId: optUuid,
  notes: z.string().max(2000).nullish(),
  items: z.array(receptionLine).max(1000).optional(),
}).passthrough();

/* ─── Écart de prix à la réception : décision ─────────────────────────────── */
// controller.decidePrice : decision ∈ {approved, rejected} (déjà refusé sinon), note facultative.
export const priceDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected'], { errorMap: () => ({ message: 'Décision invalide (approved ou rejected)' }) }),
  note: z.string().max(2000).nullish(),
}).passthrough();

/* ─── Réapprovisionnement boutique ────────────────────────────────────────── */
// controller.checkItems : liste vide ou absente = rien de bloqué ; ids passés à `= ANY($1)`.
export const replenishmentCheckItemsSchema = z.object({
  productIds: z.array(uuid).max(2000).nullish(),
}).passthrough();
// repository.create : priorité (défaut 'normal'), date souhaitée, notes ; productId en `= ANY($1)`.
// Le contrôleur répond « Ajoutez au moins un produit » si la liste est vide.
export const createReplenishmentSchema = z.object({
  priority: z.string().max(20).nullish(),
  neededBy: optDate,
  notes: optText(2000),
  items: z.array(z.object({
    productId: uuid,
    requestedQuantity: num('Quantité demandée'),
    suggestedQuantity: optNumber,
  }).passthrough()).max(2000).optional(),
}).passthrough();
// repository.startPreparing : qty_to_store, qty_to_stock, source par ligne (« Renseignez les quantités… »).
export const prepareReplenishmentSchema = z.object({
  items: z.array(z.object({
    itemId: uuid,
    qtyToStore: num('Quantité vers la boutique'),
    qtyToStock: num('Quantité vers le stock'),
    source: z.string().max(20).nullish(),
  }).passthrough()).max(2000).optional(),
}).passthrough();
// repository.confirmReception : quantité reçue par ligne (0 possible = rien reçu, écart tracé).
export const confirmReplenishmentReceptionSchema = z.object({
  items: z.array(z.object({
    itemId: uuid,
    qtyReceived: num('Quantité reçue'),
    notes: z.string().max(2000).nullish(),
  }).passthrough()).max(2000).optional(),
}).passthrough();
// repository.saveInventoryCheck : totaux additionnés (nombres), destination par défaut 'reexpose'.
export const replenishmentInventoryCheckSchema = z.object({
  sessionId: optUuid,
  notes: optText(2000),
  items: z.array(z.object({
    productId: uuid,
    productName: z.string().max(300).nullish(),
    replenishedQty: num('Quantité approvisionnée'),
    soldQty: num('Quantité vendue'),
    remainingQty: num('Quantité restante'),
    destination: z.string().max(20).nullish(),
    displayStatus: z.string().max(40).nullish(),
    lossReason: z.string().max(60).nullish(),
  }).passthrough()).max(2000).optional(),
}).passthrough();
