import { z } from 'zod';
import { uuid, optUuid, optDate, optText, optNumber } from './common.validator.js';
import { addSurplusSchema, consumeSchema, recordLossSchema, adjustSchema } from './stock-frigo.validator.js';
import { createStockLocationSchema, updateStockLocationSchema } from './stock-location.validator.js';

/**
 * Plan pilote — étape 3, lot stock (G0-07 ciblé). Même règle que le lot caisse et ventes :
 * chaque schéma reprend les types et les règles que le contrôleur ou le dépôt appliquent déjà
 * (voir le commentaire de chaque bloc), jamais une règle métier nouvelle ; corps en passthrough.
 * Un champ dont l'absence est déjà signalée par un message clair du contrôleur reste facultatif ici.
 * Aucun signe n'est imposé quand le code ne l'impose pas (ajustement, écart d'inventaire).
 */

/* ─── Briques locales ───────────────────────────────────────────────────── */
/**
 * Nombre transmis TEL QUEL (nombre, texte numérique, vide ou null) : pour les fiches dont le dépôt
 * écrit la valeur reçue sans la convertir. Aucune conversion, pour ne pas changer ce qu'il reçoit.
 */
const rawNum = (min = -1e9, max = 1e9) => z.union([z.number(), z.string(), z.null()]).optional()
  .refine(v => v == null || v === '' || (Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max), 'Nombre invalide');
/** Identifiant transmis tel quel : uuid, chaîne vide ou null (le dépôt fait `|| null` ou `?? null`). */
const rawUuid = z.union([uuid, z.literal(''), z.null()]).optional();
/** Texte que le contrôleur tronque lui-même (slice) : borne large, aucun refus d'un texte légitime. */
const slicedText = optText(10000);
const nonBlankName = (max: number) => z.string().max(max, 'Nom trop long').refine(v => v.trim().length > 0, 'Le nom est obligatoire');

/* ─── Lots matière (ingredient-lot.controller) ───────────────────────────── */
// quarantine : motif facultatif, tronqué à 500 caractères ; le client n'envoie pas de corps.
export const lotQuarantineSchema = z.preprocess(v => v ?? {}, z.object({ reason: slicedText }).passthrough());
// moveLocation : « Emplacement de destination requis » renvoyé par le contrôleur ; motif tronqué à 30.
export const lotMoveLocationSchema = z.object({ toLocationId: optUuid, motif: slicedText }).passthrough();
// M6-02 (mig 605) : lot produit fini vers un emplacement. Origine absente = part non rangée
// (sortie de production) ; destination absente = retrait de l'emplacement (correction).
export const productLotMoveLocationSchema = z.object({
  fromLocationId: z.string().guid('Emplacement d\'origine invalide').nullable().optional(),
  toLocationId: z.string().guid('Emplacement de destination invalide').nullable().optional(),
  quantity: z.number().finite().positive('La quantité doit être positive').max(1_000_000),
  motif: z.string().trim().max(30).optional(),
}).refine(v => v.fromLocationId || v.toLocationId, { message: 'Origine ou destination requise' });
// saveQualityCheck : critères vrai / faux / sans objet (null), température DECIMAL(5,1) (négative possible).
const nullableBool = z.boolean().nullish();
export const receptionQualityCheckSchema = z.object({
  temperatureOk: nullableBool,
  temperatureValue: z.preprocess(v => (v === '' ? null : v), z.coerce.number().finite('Température invalide').min(-9999.9).max(9999.9, 'Température invalide').nullish()),
  visualOk: nullableBool, packagingOk: nullableBool, labelsOk: nullableBool, overallConformity: nullableBool,
  notes: optText(5000),
}).passthrough();
// movement / open-to-pesage / return-to-economat / pesage-waste : le contrôleur exige lui-même
// « quantité > 0 » et le motif selon le type (messages clairs) ; ici seulement les types.
const lotQtyFields = {
  quantity: optNumber, containerCount: optNumber, reason: slicedText,
  reasonCode: z.string().max(200).nullish(), note: slicedText,
};
export const lotMovementSchema = z.object({ type: z.string().max(40).optional(), ...lotQtyFields }).passthrough();
export const lotQuantityActionSchema = z.object(lotQtyFields).passthrough();
// sendToLosses (lot matière ou lot produit) : « Motif requis » renvoyé par le contrôleur.
export const lotSendToLossesSchema = z.object({ reason: optText(200), note: optText(5000) }).passthrough();

/* ─── Lots produits (product-lot.controller) ─────────────────────────────── */
// sendOrphanToLosses : « productId et motif requis » renvoyé par le contrôleur.
export const orphanToLossesSchema = z.object({ productId: optUuid, reason: optText(200), note: optText(5000) }).passthrough();

/* ─── Clôture de stock (inventory.controller.closingCreate) ─────────────── */
// Libellé et date requis (message du contrôleur) ; period_label VARCHAR(40), closing_date DATE.
export const stockClosingSchema = z.object({
  periodLabel: z.string().trim().max(40, 'Libellé de période trop long (40 caractères)').optional(),
  closingDate: optDate, notes: optText(5000),
}).passthrough();

/* ─── Fiche ingrédient (inventory.repository ingredientRepository) ───────── */
// create : name et unit_cost NOT NULL (DECIMAL(12,4)) ; le dépôt écrit les valeurs reçues.
// Allergènes : contrôlés par le contrôleur (référentiel fermé), unité : requireUnits.
const ingredientFields = {
  unit: z.string().max(20).optional(), supplier: optText(200), category: z.string().max(60).nullish(),
  categoryId: rawUuid, containerTypeId: rawUuid,
  containerSize: rawNum(0, 1e7), densiteKgL: rawNum(0, 1e6), poidsPieceKg: rawNum(0, 1e6),
  // Matière non stockée (eau du réseau) : exclue des besoins, des bons de sortie et des achats (mig 347, constat 134).
  nonStocke: z.boolean().optional(),
};
export const createIngredientSchema = z.object({
  name: nonBlankName(200),
  unitCost: z.union([z.number(), z.string()], { error: 'Coût unitaire requis' })
    .refine(v => v !== '' && Number.isFinite(Number(v)) && Math.abs(Number(v)) < 1e8, 'Coût unitaire invalide'),
  ...ingredientFields,
}).passthrough();
// update : mise à jour partielle (champ absent = inchangé).
export const updateIngredientSchema = z.object({
  name: nonBlankName(200).optional(), unitCost: rawNum(-1e8, 1e8), ...ingredientFields,
}).passthrough();
// convertToConsumable : catégorie facultative (`|| null`).
export const convertToConsumableSchema = z.object({ categoryId: optUuid }).passthrough();

/* ─── Emballages / consommables (packaging-item.repository) ─────────────── */
// create : name NOT NULL ; le reste a une valeur par défaut. Clés en snake_case.
const packagingFields = {
  format: optText(120), unit: z.string().max(20).optional(), unit_cost: rawNum(-1e8, 1e8),
  supplier: optText(200), category: z.string().max(40).optional(), category_id: rawUuid,
  is_recyclable: z.boolean().optional(), is_compostable: z.boolean().optional(), is_food_safe: z.boolean().optional(),
  notes: optText(10000),
};
export const createPackagingSchema = z.object({ name: nonBlankName(200), ...packagingFields }).passthrough();
export const updatePackagingSchema = z.object({ name: nonBlankName(200).optional(), is_active: z.boolean().optional(), ...packagingFields }).passthrough();
// adjustStock : variation SIGNÉE (réception +, perte / consommation −), parseFloat côté contrôleur.
// Type : packaging_stock_transactions.type (CHECK en base), 'adjustment' par défaut.
export const packagingAdjustStockSchema = z.object({
  quantity: z.coerce.number({ error: 'Quantité invalide' }).finite('Quantité invalide').min(-1e7).max(1e7, 'Quantité trop élevée'),
  type: z.preprocess(v => (v === '' || v === null ? undefined : v),
    z.enum(['reception', 'consumption', 'adjustment', 'waste', 'restock'], { error: 'Type de mouvement inconnu' }).optional()),
  note: optText(5000), unitCost: optNumber,
}).passthrough();

/* ─── Transfert de produits finis (product-transfer.controller) ─────────── */
// « Site source et destination requis » et « Ajoutez au moins une ligne » renvoyés par le code ;
// les lignes sans produit ou à quantité ≤ 0 sont ignorées par le dépôt (aucun signe imposé ici).
export const productTransferSchema = z.object({
  fromStoreId: optUuid, toStoreId: optUuid,
  items: z.array(z.object({ productId: rawUuid, quantity: rawNum(-1e7, 1e7) }).passthrough()).max(1000).optional(),
  notes: optText(5000), transferDate: optDate,
}).passthrough();

/* ─── Contrôle d'ouverture (opening-inventory-check) ────────────────────── */
// expected_qty / found_qty INTEGER ; missing_reason CHECK en base ; le contrôleur exige le motif
// en cas d'écart. Comparaison stricte (!==) et sommes côté dépôt : nombres attendus, pas de texte.
const MISSING_REASONS = ['theft', 'breakage', 'forgotten_recycle', 'undeclared_loss', 'measurement_error', 'other'] as const;
const intQty = z.number({ error: (iss) => (iss.input === undefined ? 'Quantité requise' : 'Quantité invalide') }).int('Quantité entière attendue').min(-1e7).max(1e7);
export const openingCheckSchema = z.object({
  previousCheckId: z.union([uuid, z.null()]).optional(),
  items: z.array(z.object({
    productId: uuid, expectedQty: intQty, foundQty: intQty,
    missingReason: z.union([z.enum(MISSING_REASONS, { error: 'Motif d\'écart inconnu' }), z.literal(''), z.null()]).optional(),
  }).passthrough(), { error: 'items doit être un tableau' }).max(2000).optional(),
  notes: optText(5000),
}).passthrough();
// validate : « action doit être approve ou reject » et motif de rejet contrôlés par le contrôleur.
export const openingCheckValidateSchema = z.object({ action: z.string().max(20).optional(), rejectionReason: optText(2000) }).passthrough();

/* ─── État thermique (lot-thermal.controller) ───────────────────────────── */
// thaw : durée de vie en heures, nombre ; une valeur ≤ 0 prend le défaut (48 h) côté dépôt.
export const lotThawSchema = z.preprocess(v => v ?? {}, z.object({ dureeVieHeures: z.number({ error: 'Durée de vie invalide' }).finite().nullish() }).passthrough());

/* ─── Stock frigo / emplacements : schémas existants, en passthrough ────── */
// Le contrôleur les rejoue (safeParse) ; ici, champs non déclarés conservés (storeId lu dans le corps).
export const frigoSurplusSchema = addSurplusSchema.passthrough();
export const frigoConsumeSchema = consumeSchema.passthrough();
export const frigoLossSchema = recordLossSchema.passthrough();
export const frigoAdjustSchema = adjustSchema.passthrough();
export const stockLocationCreateSchema = createStockLocationSchema.passthrough();
export const stockLocationUpdateSchema = updateStockLocationSchema.passthrough();
