import { z } from 'zod';

export const addSurplusSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().positive(),
  lotNumber: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
  sourcePlanId: z.string().uuid().optional(),
  sourceContenantId: z.string().uuid().optional(),
  notes: z.string().optional(),
});

export const consumeSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().positive(),
  referenceId: z.string().uuid().optional(),
  referenceType: z.string().optional(),
});

export const recordLossSchema = z.object({
  quantity: z.number().positive(),
  type: z.enum(['loss', 'expired']),
  notes: z.string().optional(),
});

export const adjustSchema = z.object({
  quantity: z.number().min(0),
  notes: z.string().optional(),
});
