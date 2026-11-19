import { z } from 'zod';
import { body, txt, numish } from './route-body.validator.js';

/**
 * G0-07 — Immobilisations (fixed-asset.routes). fixed-asset.controller garde ses messages
 * (champs requis, mois 1-12) et le dépôt ses règles ; types seulement.
 * Volontairement NON imposé : signe ou plafond du coût d'acquisition, de la valeur résiduelle
 * et de la durée (non bornés aujourd'hui côté serveur).
 */
const ref = z.union([z.string().max(60), z.number()]).nullish();
export const createFixedAssetSchema = body({
  label: txt(300), assetAccountId: ref, depreciationAccountId: ref, expenseAccountId: ref,
  acquisitionDate: txt(40), acquisitionCost: numish, residualValue: numish, durationYears: numish,
  method: txt(20), supplierId: z.string().max(60).nullish(), notes: txt(2000),
});
export const runDepreciationSchema = body({ year: numish, month: numish });
