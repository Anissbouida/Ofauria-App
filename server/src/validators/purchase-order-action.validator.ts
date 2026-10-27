import { z } from 'zod';

/** Actions motivées sur le BC (mig 306) : code motif du référentiel purchase_reason_codes + note facultative. */
export const reasonCodeSchema = z.object({
  reasonCodeId: z.string().uuid('Motif requis'),
  note: z.string().trim().max(1000).optional().transform(v => (v ? v : null)),
});

export const optionalNoteSchema = z.object({
  note: z.string().trim().max(1000).optional().transform(v => (v ? v : null)),
});

const isoDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ');

/** Demande de changement (avenant) d'un BC engagé (mig 307). */
export const changeOrderSchema = reasonCodeSchema.extend({
  header: z.object({
    expectedDeliveryDate: isoDate.nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  }).optional(),
  lines: z.array(z.object({
    id: z.string().uuid(),
    qtyContainer: z.coerce.number().finite().positive().max(1_000_000).optional(),
    unitPrice: z.coerce.number().finite().min(0).max(10_000_000).nullable().optional(),
    discountPct: z.coerce.number().finite().min(0).max(100).optional(),
    tvaRate: z.coerce.number().finite().min(0).max(100).nullable().optional(),
    expectedDate: isoDate.nullable().optional(),
  })).max(500).optional(),
});

/** Correction d'une ligne de réception : quantité signée en unité de base (mig 308). */
export const correctReceiptSchema = reasonCodeSchema.extend({
  delta: z.coerce.number().finite().refine(v => Math.abs(v) > 0.0001, 'Quantité de correction requise').refine(v => Math.abs(v) <= 1_000_000, 'Quantité trop élevée'),
});

/**
 * Creation d'un bon de commande (POST /purchase-orders) — F-002.
 * Sans ce schema, un type invalide (quantityOrdered:"abc") ou une ligne mal
 * formee faisait echouer l'INSERT cote Postgres en 500. On valide la FORME ;
 * l'existence des cles etrangeres (fournisseur, article) reste verifiee par la
 * base et traduite en 400 par le controleur.
 */
export const createPurchaseOrderSchema = z.object({
  supplierId: z.string().uuid('Fournisseur invalide'),
  expectedDeliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ').optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  // BC en devise (mig 363) : taux figé, prix des lignes en DH, prix d'origine dans foreignUnitPrice.
  currencyCode: z.string().regex(/^[A-Z]{3}$/, 'Devise invalide').optional(),
  exchangeRate: z.coerce.number().positive('Taux de change invalide').max(100_000).optional(),
  items: z.array(
    z.object({
      ingredientId: z.string().uuid('Ingrédient invalide').optional().nullable(),
      packagingId: z.string().uuid('Consommable invalide').optional().nullable(),
      // Ligne sans article (mig 349) : service ou immobilisation, désignation + catégorie de dépense.
      lineType: z.enum(['ingredient', 'consumable', 'service', 'asset']).optional().nullable(),
      description: z.string().max(500).optional().nullable(),
      categoryId: z.string().uuid('Catégorie invalide').optional().nullable(),
      unit: z.string().max(20).optional().nullable(),
      quantityOrdered: z.coerce.number().positive('Quantité commandée invalide (doit être > 0)').max(1_000_000),
      unitPrice: z.coerce.number().min(0, 'Prix invalide').max(1_000_000).optional().nullable(),
      foreignUnitPrice: z.coerce.number().min(0, 'Prix en devise invalide').max(1_000_000).optional().nullable(),
    }).refine((i) => {
      if (i.lineType === 'service' || i.lineType === 'asset') {
        return !i.ingredientId && !i.packagingId && Boolean(i.description?.trim()) && Boolean(i.categoryId);
      }
      return Boolean(i.ingredientId) !== Boolean(i.packagingId);
    }, {
      message: 'Une ligne porte soit un ingrédient, soit un consommable, soit (service / immobilisation) une désignation et une catégorie.',
    }),
  ).min(1, 'Au moins un article requis').max(200),
}).passthrough();
