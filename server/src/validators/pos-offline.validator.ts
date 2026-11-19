import { z } from 'zod';

/**
 * G0-21 (reste, mig 596) — remontée d'une vente hors ligne abandonnée à la caisse.
 * La caisse envoie ce qu'elle tenait en local : la vente (payload), le motif du refus
 * du serveur et le motif de l'abandon saisi par le caissier.
 */
const isoDate = z.string().trim().max(40).refine(s => !Number.isNaN(Date.parse(s)), 'Date invalide');

export const offlineAbandonedSchema = z.object({
  idempotencyKey: z.string().trim().min(1, 'Clé d\'idempotence requise').max(64),
  queuedAt: isoDate.optional().nullable(),
  rejectedAt: isoDate.optional().nullable(),
  abandonedAt: isoDate,
  total: z.number().finite().min(0).max(9_999_999).optional().nullable(),
  summary: z.string().trim().max(300).optional().nullable(),
  rejectReason: z.string().trim().min(1).max(500),
  rejectStatus: z.number().int().min(100).max(599).optional().nullable(),
  rejectCode: z.string().trim().max(80).optional().nullable(),
  abandonReason: z.string().trim().min(3, 'Motif de l\'abandon obligatoire (3 caractères au moins)').max(200),
  // La vente telle que la caisse l'aurait envoyée (schéma de /sales/checkout, non revalidé ici :
  // elle a justement été refusée). Bornée pour ne pas servir de dépôt arbitraire.
  payload: z.record(z.unknown()).refine(p => JSON.stringify(p).length <= 50_000, 'Vente trop volumineuse'),
});

export type OfflineAbandonedInput = z.infer<typeof offlineAbandonedSchema>;
