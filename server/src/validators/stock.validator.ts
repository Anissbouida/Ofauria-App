import { z } from 'zod';

/**
 * G0-07 — entrées, ajustements et seuil du stock de matières.
 * Les clés inconnues sont conservées (`passthrough`) : le contrôleur en lit
 * d'autres selon le type de mouvement.
 */
const blank = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : v);
const uuid = z.string().uuid('Ingrédient invalide');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue : AAAA-MM-JJ');
const MAX_QTY = 100_000_000;

export const restockSchema = z.object({
  ingredientId: uuid,
  quantity: z.coerce.number().finite().positive('Quantité attendue > 0').max(MAX_QTY),
  note: z.preprocess(blank, z.string().max(1000).optional()),
  supplierLotNumber: z.preprocess(blank, z.string().trim().max(100).optional()),
  expirationDate: z.preprocess(blank, isoDate.optional()),
  manufacturedDate: z.preprocess(blank, isoDate.optional()),
}).passthrough();

export const adjustStockSchema = z.object({
  ingredientId: uuid,
  // Signée : un ajustement peut retirer du stock.
  quantity: z.coerce.number().finite().min(-MAX_QTY).max(MAX_QTY),
  type: z.preprocess(blank, z.enum(['restock', 'usage', 'adjustment', 'waste', 'recycle', 'production']).optional()),
  note: z.preprocess(blank, z.string().max(1000).optional()),
  reasonCode: z.preprocess(blank, z.string().regex(/^[a-z0-9_]{1,40}$/).optional()),
}).passthrough();

export const stockThresholdSchema = z.object({
  ingredientId: uuid,
  threshold: z.coerce.number().finite().min(0, 'Seuil négatif refusé').max(MAX_QTY),
}).passthrough();
