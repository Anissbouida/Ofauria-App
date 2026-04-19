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

const LOSS_TYPES = ['production', 'casse', 'non_vendu', 'perime', 'recyclage', 'vitrine'] as const;

export const createProductLossSchema = z.object({
  productId: uuid,
  quantity: positiveQuantity,
  lossType: z.enum(LOSS_TYPES),
  reason: z.string().trim().min(1, 'Raison requise').max(200),
  reasonNote: z.string().trim().max(1000).optional(),
  productionPlanId: uuid.optional(),
  photoUrl: z.string().trim().max(500).optional(),
});

export { moneyAmount, positiveQuantity };
