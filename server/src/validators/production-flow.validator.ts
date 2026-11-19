import { z } from 'zod';
import { optNumber } from './common.validator.js';
import {
  generateBonSchema, regenerateBonSchema, updateLigneSchema, weighLignesSchema, markReadySchema,
  chefRejectSchema, cancelBonSchema, transferLineSchema,
} from './bon-sortie.validator.js';
import { createContenantSchema, updateContenantSchema, bulkIdsSchema, upsertProfileSchema } from './production-contenant.validator.js';
import { createEquipementSchema, updateEquipementSchema, recordTempsTravailSchema, recordEquipementUsageSchema } from './production-cout.validator.js';
import {
  updateEtapeStatusSchema, completeRepetitionSchema, addReadingSchema, retroPlanningSchema, recordRendementSchema,
} from './production-etapes.validator.js';

/**
 * Plan pilote — étape 2, lot production (G0-07 ciblé). Même règle que sales-flow.validator :
 * un schéma reprend ce que le contrôleur et le dépôt vérifient déjà, jamais une règle métier
 * nouvelle ; corps en `.passthrough()` (validate() remplace req.body).
 *
 * Deux familles :
 *  1. Le contrôleur valide DÉJÀ son corps avec un schéma (bons de sortie, étapes, coûts,
 *     formats) : la route branche ce même schéma, en passthrough. L'ensemble des corps acceptés
 *     est identique à celui du contrôleur (qui re-valide ensuite le résultat — idempotent :
 *     mêmes défauts, mêmes trim). Le message affiché passe par error.details (client/api/errors.ts).
 *  2. Le contrôleur lit req.body à la main (paramètres, ateliers, calcul des besoins, réception
 *     de transfert) : schéma écrit ici, champs facultatifs quand le contrôleur renvoie lui-même un
 *     message clair s'il manque.
 */

/** Corps absent = objet vide (les contrôleurs lisent `req.body ?? {}` / `req.body || {}`). */
const body = <T extends z.AnyZodObject>(schema: T) => z.preprocess(v => v ?? {}, schema.passthrough());

/* ─── 1. Schémas déjà appliqués par le contrôleur ─────────────────────────── */

// Bons de sortie (bon-sortie.controller) — la pesée, l'ouverture de contenant et la remise
// gardent leurs règles (tolérance, motif hors bande, lots) dans le dépôt.
export const generateBonBody = body(generateBonSchema);
export const regenerateBonBody = body(regenerateBonSchema);
export const updateLigneBody = body(updateLigneSchema);
export const weighLignesBody = body(weighLignesSchema);
export const markReadyBody = body(markReadySchema);
export const chefRejectBody = body(chefRejectSchema);
export const cancelBonBody = body(cancelBonSchema);
export const transferLineBody = body(transferLineSchema);

// Formats de production (production-contenant.controller).
export const createContenantBody = body(createContenantSchema);
export const updateContenantBody = body(updateContenantSchema);
export const bulkContenantIdsBody = body(bulkIdsSchema);
export const upsertProfileBody = body(upsertProfileSchema);

// Coûts (production-cout.controller) — le type d'équipement reste contrôlé contre le référentiel.
export const createEquipementBody = body(createEquipementSchema);
export const updateEquipementBody = body(updateEquipementSchema);
export const recordTempsTravailBody = body(recordTempsTravailSchema);
export const recordEquipementUsageBody = body(recordEquipementUsageSchema);

// Étapes et rendement (production-etapes.controller) — garde CCP, interrupteur « Rendement »
// et code du paramètre de relevé restent dans le contrôleur.
export const updateEtapeStatusBody = body(updateEtapeStatusSchema);
export const completeRepetitionBody = body(completeRepetitionSchema);
export const addReadingBody = body(addReadingSchema);
export const retroPlanningBody = body(retroPlanningSchema);
export const recordRendementBody = body(recordRendementSchema);

/* ─── 2. Corps lus à la main par le contrôleur ────────────────────────────── */

/** Identifiant facultatif dont `null` / '' signifient « retirer » (≠ absent = inchangé). */
const clearableUuid = z.union([z.string().uuid('Identifiant invalide'), z.literal(''), z.null()]).optional();

// production-etapes.controller.assignEtape : poste et opérateur, null ou '' = retirer
// (colonnes UUID work_center_id / assigned_employee_id).
export const assignEtapeSchema = z.object({
  workCenterId: clearableUuid,
  assignedEmployeeId: clearableUuid,
}).passthrough();

// production.controller.updateSettings : num() = Number(v), vide / null = inchangé ; bool() =
// Boolean(v). Aucune borne dans le code (pourcentages libres) : seuls les types sont repris.
const settingFlag = z.boolean({ invalid_type_error: 'Valeur oui / non attendue' }).nullish();
export const productionSettingsSchema = z.object({
  chargesFixesPct: optNumber,
  overproductionPct: optNumber,
  markupPercent: optNumber,
  stepsEnabled: settingFlag,
  stepsBlocking: settingFlag,
  yieldEnabled: settingFlag,
  costEnabled: settingFlag,
}).passthrough();

// production.controller.saveWorkshop : libellé requis (message du contrôleur, donc facultatif
// ici), catégories = entiers, membres = textes, poste facultatif (clé étrangère contrôlée).
export const saveWorkshopSchema = z.object({
  label: z.string({ invalid_type_error: 'Libellé invalide' }).max(200).optional(),
  workCenterId: z.string().max(80).nullish(),
  categoryIds: z.array(z.number({ invalid_type_error: 'Catégorie invalide' }).int('Catégorie invalide')).max(1000).nullish(),
  memberRoles: z.array(z.string({ invalid_type_error: 'Rôle invalide' }).max(80)).max(500).nullish(),
  memberUsers: z.array(z.string({ invalid_type_error: 'Utilisateur invalide' }).max(80)).max(1000).nullish(),
  // isDefault === true, isActive !== false, sortOrder entier sinon 100 : le contrôleur tolère
  // toute autre valeur (repli), le schéma ne la refuse donc pas.
  isDefault: z.boolean().nullish(),
  isActive: z.boolean().nullish(),
  sortOrder: z.union([z.number(), z.string().max(20), z.null()]).optional(),
}).passthrough();

// production.controller.mrpGenerate / mrpGeneratePurchaseRequests : date AAAA-MM-JJ (message
// « Date requise » du contrôleur, donc facultative ici), magasin facultatif (résolu par le dépôt).
export const mrpGenerateSchema = z.object({
  date: z.string({ invalid_type_error: 'Date invalide' }).max(10, 'Date invalide').optional(),
  store: z.string().max(80).nullish(),
}).passthrough();

// production.controller.confirmProductionTransfer : liste requise (message « Confirmez les
// quantités reçues » du contrôleur, donc facultative ici) ; production.repository
// .confirmTransferReception lit itemId (UUID) et qtyReceived (nombre, écart = reçu − transféré).
export const receiveProductionTransferSchema = z.object({
  items: z.array(z.object({
    itemId: z.string().uuid('Ligne de transfert invalide'),
    // Le client envoie un nombre, ou la quantité transférée telle que lue en base (numeric = texte).
    // Aucun plancher dans le code (0 = rien reçu ; négatif non refusé) : seul le type est repris.
    qtyReceived: z.union([z.null(), z.coerce.number({ invalid_type_error: 'Quantité reçue invalide' }).finite('Quantité reçue invalide')]),
    notes: z.string().max(2000).nullish(),
  }).passthrough()).max(1000).optional(),
}).passthrough();
