import { z } from 'zod';

/**
 * G0-01 — charge utile de l'API publique de commande. Bornes strictes : la
 * requête vient d'un tiers. `unitPrice` n'est pris en compte que si la clé
 * d'API porte la portée `orders:price_override` (sinon ignoré par le service).
 */
const uuid = z.string().guid();

export const publicOrderItemSchema = z.object({
  productId: uuid,
  quantity: z.number().positive().max(100000),
  unitPrice: z.number().min(0).max(10_000_000).optional(),
}).strict();

export const publicOrderSchema = z.object({
  customerId: uuid.nullish(),
  customerName: z.string().trim().min(1).max(200).nullish(),
  customerPhone: z.string().trim().max(30).nullish(),
  items: z.array(publicOrderItemSchema).min(1).max(200),
  notes: z.string().max(1000).optional(),
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue : AAAA-MM-JJ').optional(),
}).strict();

export type PublicOrderBody = z.infer<typeof publicOrderSchema>;

/** Les routes GET de l'API publique n'acceptent aucun paramètre de requête libre. */
export const publicEmptyQuerySchema = z.object({}).strict();

/** En-tête Idempotency-Key : 8 à 200 caractères imprimables. */
export const IDEMPOTENCY_KEY_RE = /^[\x21-\x7E]{8,200}$/;
