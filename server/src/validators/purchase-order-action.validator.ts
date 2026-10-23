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
