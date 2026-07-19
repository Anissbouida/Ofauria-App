import { z } from 'zod';

// Montants monetaires : nombre strictement positif, borne superieure pour
// eviter les abus et les erreurs de saisie (OWASP A04/A08 business logic).
const moneyAmount = z.coerce.number()
  .finite('Montant invalide')
  .positive('Le montant doit etre strictement positif')
  .max(999999.99, 'Montant trop eleve');

// Quantite : nombre positif, plafond metier raisonnable.
const positiveQuantity = z.coerce.number()
  .finite('Quantite invalide')
  .positive('La quantite doit etre strictement positive')
  .max(100000, 'Quantite trop elevee');

const uuid = z.string().uuid('Identifiant UUID invalide');

// N9 — Aligner strictement Zod avec les CHECK DB (mig 068, 107, 252).
// Avant : Zod acceptait 'casse'/'non_vendu' (obsoletes) et un reason texte
// libre -> le CHECK DB rejetait au POST -> 500 au lieu de 400.
const LOSS_TYPES = ['production', 'vitrine', 'perime', 'recyclage'] as const;
const LOSS_REASONS = [
  'brule', 'rate', 'machine', 'matiere_defectueuse', 'erreur_humaine',
  'chute', 'casse', 'qualite_non_conforme', 'retour_client', 'perime',
  'invendu_fin_journee', 'invendu_vitrine', 'recycle', 'autre',
  'dlc_expiree', 'dlv_expiree', 'ecart_inventaire', 'ecart_ouverture',
] as const;

export const createProductLossSchema = z.object({
  productId: uuid,
  quantity: positiveQuantity,
  lossType: z.enum(LOSS_TYPES),
  reason: z.enum(LOSS_REASONS),
  reasonNote: z.string().trim().max(1000).optional(),
  productionPlanId: uuid.optional(),
  photoUrl: z.string().trim().max(500).optional(),
});

export { moneyAmount, positiveQuantity };
