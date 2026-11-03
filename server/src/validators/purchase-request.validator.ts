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

// Flux procure-to-pay (mig 457) : plus de génération de BC depuis une DA
// (generatePOSchema supprimé) ; le sourcing passe par POST /rfqs/from-requests.
