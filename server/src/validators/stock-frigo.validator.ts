import { z } from 'zod';

// Règles inchangées ; messages en français (plan pilote, étape 3). Le contrôleur rejoue ces
// schémas ; les routes les appliquent en passthrough (stock-flow.validator).
const id = (label: string) => z.string({ error: `${label} requis` }).guid(`${label} invalide`);
const qty = z.number({ error: (iss) => (iss.input === undefined ? 'Quantité requise' : 'Quantité invalide') });

export const addSurplusSchema = z.object({
  productId: id('Produit'),
  quantity: qty.positive('La quantité doit être positive'),
  lotNumber: z.string().optional(),
  expiresAt: z.string().datetime('Date d\'expiration invalide').optional(),
  sourcePlanId: id('Plan source').optional(),
  sourceContenantId: id('Contenant source').optional(),
  notes: z.string().optional(),
});

export const consumeSchema = z.object({
  productId: id('Produit'),
  quantity: qty.positive('La quantité doit être positive'),
  referenceId: id('Référence').optional(),
  referenceType: z.string().optional(),
});

export const recordLossSchema = z.object({
  quantity: qty.positive('La quantité doit être positive'),
  type: z.enum(['loss', 'expired'], { error: 'Type de perte : loss ou expired' }),
  notes: z.string().optional(),
});

export const adjustSchema = z.object({
  quantity: qty.min(0, 'Quantité négative'),
  notes: z.string().optional(),
});
