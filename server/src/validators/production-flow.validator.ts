import { z } from 'zod';
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
const body = <T extends z.ZodObject>(schema: T) => z.preprocess(v => v ?? {}, schema.passthrough());

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
const clearableUuid = z.union([z.string().guid('Identifiant invalide'), z.literal(''), z.null()]).optional();

// production-etapes.controller.assignEtape : poste et opérateur, null ou '' = retirer
// (colonnes UUID work_center_id / assigned_employee_id).
export const assignEtapeSchema = z.object({
  workCenterId: clearableUuid,
  assignedEmployeeId: clearableUuid,
}).passthrough();

// production.controller.updateSettings : num() = Number(v), vide / null = inchangé ; bool() =
// Boolean(v). Règle pilote 2026-11 n° 13 : charges fixes et surproduction entre 0 et 100 %,
// marge entre 0 et 1000 %. ATTENTION : chargesFixesPct est une FRACTION (0,40 = 40 %, colonne
// NUMERIC(5,4), l'écran divise par 100) : sa borne est donc 0..1 ; les deux autres sont en %.
const settingPct = (label: string, max: number, range = `entre 0 et ${max}`) => z.preprocess(v => (v === '' || v === null ? undefined : v),
  z.coerce.number({ error: `${label} invalide` }).finite(`${label} invalide`)
    .min(0, `${label} : valeur ${range}`).max(max, `${label} : valeur ${range}`).optional());
const settingFlag = z.boolean({ error: 'Valeur oui / non attendue' }).nullish();
export const productionSettingsSchema = z.object({
  chargesFixesPct: settingPct('Charges fixes', 1, 'entre 0 et 100 %'),
  overproductionPct: settingPct('Surproduction (%)', 100),
  // Décision : 0..1000 % ; la colonne production_markup_percent est DECIMAL(5,2) (mig 142), d'où
  // 999,99 au plus (1000 ferait échouer l'écriture en 500).
  markupPercent: settingPct('Marge (%)', 999.99, 'entre 0 et 999,99'),
  stepsEnabled: settingFlag,
  stepsBlocking: settingFlag,
  yieldEnabled: settingFlag,
  costEnabled: settingFlag,
}).passthrough();

// production.controller.saveWorkshop : libellé requis (message du contrôleur, donc facultatif
// ici), catégories = entiers, membres = textes, poste facultatif (clé étrangère contrôlée).
export const saveWorkshopSchema = z.object({
  label: z.string({ error: 'Libellé invalide' }).max(200).optional(),
  workCenterId: z.string().max(80).nullish(),
  categoryIds: z.array(z.number({ error: 'Catégorie invalide' }).int('Catégorie invalide')).max(1000).nullish(),
  recipeCategoryIds: z.array(z.string().guid('Catégorie de fiche invalide')).max(500).optional(),
  memberRoles: z.array(z.string({ error: 'Rôle invalide' }).max(80)).max(500).nullish(),
  memberUsers: z.array(z.string({ error: 'Utilisateur invalide' }).max(80)).max(1000).nullish(),
  // isDefault === true, isActive !== false, sortOrder entier sinon 100 : le contrôleur tolère
  // toute autre valeur (repli), le schéma ne la refuse donc pas.
  isDefault: z.boolean().nullish(),
  isActive: z.boolean().nullish(),
  sortOrder: z.union([z.number(), z.string().max(20), z.null()]).optional(),
}).passthrough();

// production.controller.mrpGenerate / mrpGeneratePurchaseRequests : date AAAA-MM-JJ (message
// « Date requise » du contrôleur, donc facultative ici), magasin facultatif (résolu par le dépôt).
export const mrpGenerateSchema = z.object({
  date: z.string({ error: 'Date invalide' }).max(10, 'Date invalide').optional(),
  store: z.string().max(80).nullish(),
}).passthrough();

// production.controller.confirmProductionTransfer : liste requise (message « Confirmez les
// quantités reçues » du contrôleur, donc facultative ici) ; production.repository
// .confirmTransferReception lit itemId (UUID) et qtyReceived (nombre, écart = reçu − transféré).
export const receiveProductionTransferSchema = z.object({
  items: z.array(z.object({
    itemId: z.string().guid('Ligne de transfert invalide'),
    // Le client envoie un nombre, ou la quantité transférée telle que lue en base (numeric = texte).
    // 0 = rien reçu (écart tracé) ; règle pilote 2026-11 n° 7 : un négatif est refusé.
    qtyReceived: z.union([z.null(), z.coerce.number({ error: 'Quantité reçue invalide' }).finite('Quantité reçue invalide')
      .min(0, 'Quantité reçue négative : saisissez 0 si rien n\'a été reçu')]),
    notes: z.string().max(2000).nullish(),
  }).passthrough()).max(1000).optional(),
}).passthrough();
