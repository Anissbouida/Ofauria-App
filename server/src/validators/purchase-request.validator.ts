import { z } from 'zod';

/**
 * Demandes d'achat — validation d'entrée (refonte Achats D2, G-D2-13).
 * Aligné sur les CHECK de la base (mig 057, 271, 305) pour qu'une valeur
 * inattendue soit refusée en 400 et non en 500.
 */
const uuid = z.string().uuid('Identifiant invalide');
const quantity = z.coerce.number().finite('Quantité invalide').positive('La quantité doit être strictement positive').max(1_000_000, 'Quantité trop élevée');

export const REQUEST_REASONS = ['stock_bas', 'production', 'manual', 'replenishment'] as const;

export const createPurchaseRequestSchema = z.object({
  ingredientId: uuid,
  supplierId: uuid.nullable().optional(),
  quantity,
  unit: z.string().trim().min(1, 'Unité requise').max(20),
  reason: z.enum(REQUEST_REASONS).optional(),
  note: z.string().trim().max(2000).optional().transform(v => (v ? v : undefined)),
});

export const updateQuantitySchema = z.object({ quantity });

export const assignSupplierSchema = z.object({ supplierId: uuid.nullable().optional() });

export const bulkAssignSupplierSchema = z.object({
  requestIds: z.array(uuid).min(1, 'Sélectionnez au moins une demande').max(500),
  supplierId: uuid.nullable().optional(),
});

/** Annuler ou clôturer exige un motif : c'est une action humaine journalisée. */
export const reasonSchema = z.object({
  reason: z.string().trim().min(3, 'Motif requis (3 caractères minimum)').max(500),
});

export const generatePOSchema = z.object({
  supplierId: uuid,
  requestIds: z.array(uuid).min(1, 'Sélectionnez au moins une demande').max(500),
  expectedDeliveryDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ').optional().or(z.literal('').transform(() => undefined)),
  notes: z.string().trim().max(2000).optional(),
  quantityOverrides: z.record(uuid, quantity).optional(),
});

/** Stock › À commander → BC directs (un BC brouillon par fournisseur). */
export const orderDirectSchema = z.object({
  lines: z.array(z.object({
    ingredientId: z.string().uuid(),
    quantity: z.number().positive().max(1_000_000),
    supplierId: z.string().uuid(),
    unit: z.string().trim().min(1).max(20),
    requestIds: z.array(z.string().uuid()).max(200).default([]),
    reason: z.enum(['stock_bas', 'production', 'manual', 'replenishment']),
    note: z.string().trim().max(500).optional(),
  })).min(1).max(200),
  expectedDeliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
