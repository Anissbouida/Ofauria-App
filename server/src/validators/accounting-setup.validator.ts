import { z } from 'zod';
import { body, txt, numish, bool } from './route-body.validator.js';
import { optTaxCode } from './common.validator.js';

/**
 * G0-07 — Comptabilité, paramétrage : catégories de charges et de recettes (accounting.routes,
 * expenseCategoriesRouter / revenueCategoriesRouter) et charges constatées d'avance
 * (prepaid-charge.routes). Types seulement ; les contrôleurs et dépôts gardent leurs règles.
 */
const ref = z.string().max(60).nullish();
const categoryFields = {
  description: txt(2000), parent_id: ref, level: numish, display_order: numish,
  requires_po: bool, requires_qc: bool, requires_dlc: bool, requires_lot: bool, is_active: bool,
  // TVA à l'achat par défaut des articles de la catégorie (mig 309, constat 124) ; '' / null = aucun code.
  default_tax_code: optTaxCode,
};
/** Le nom est obligatoire en base (NOT NULL) : un texte non vide à la création. */
export const createAccountingCategorySchema = body({ ...categoryFields, name: z.string().trim().min(1, 'Nom requis').max(200) });
export const updateAccountingCategorySchema = body({ ...categoryFields, name: z.string().trim().min(1, 'Nom requis').max(200).optional() });

/* Charges constatées d'avance — prepaid-charge.controller (champs requis contrôlés par lui). */
export const createPrepaidChargeSchema = body({
  label: txt(300), chargeAccountCode: z.union([z.string().max(20), z.number()]).nullish(), totalAmount: numish,
  startDate: txt(40), endDate: txt(40), sourceInvoiceId: ref, notes: txt(2000),
});
export const recognizePrepaidChargesSchema = body({ id: ref, asOf: txt(40) });
