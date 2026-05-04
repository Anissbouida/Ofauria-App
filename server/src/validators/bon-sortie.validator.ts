import { z } from 'zod';

export const generateBonSchema = z.object({
  planId: z.string().uuid(),
  storeId: z.string().uuid(),
});

export const updateLigneSchema = z.object({
  actualQuantity: z.number().min(0),
  notes: z.string().optional(),
});

export const handleEcartSchema = z.object({
  substituteLotId: z.string().uuid().optional(),
  newQuantity: z.number().min(0).optional(),
});
