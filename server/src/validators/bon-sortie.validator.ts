import { z } from 'zod';

// Derogation DLC (mig 339) : autorise l'allocation de lots hors DLC, motif obligatoire.
export const derogationDlcSchema = z.object({
  motif: z.string().trim().min(5, 'Motif de derogation DLC requis (5 caracteres minimum)').max(500),
});

export const generateBonSchema = z.object({
  planId: z.string().uuid(),
  storeId: z.string().uuid(),
  derogationDlc: derogationDlcSchema.optional(),
});

export const regenerateBonSchema = z.object({
  storeId: z.string().uuid().optional(),
  derogationDlc: derogationDlcSchema.optional(),
});

export const updateLigneSchema = z.object({
  actualQuantity: z.number().min(0),
  notes: z.string().optional(),
});

export const handleEcartSchema = z.object({
  substituteLotId: z.string().uuid().optional(),
  newQuantity: z.number().min(0).optional(),
});
