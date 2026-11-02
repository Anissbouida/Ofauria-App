import { z } from 'zod';

const LOCATION_TYPES = ['sec', 'positif', 'negatif', 'pesage', 'vitrine', 'labo'] as const;
const CAPACITE_UNITES = ['bac', 'plaque', 'kg'] as const;

export const createStockLocationSchema = z.object({
  storeId: z.string().uuid().nullable().optional(),
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(120),
  type: z.enum(LOCATION_TYPES),
  parentId: z.string().uuid().nullable().optional(),
  equipementId: z.string().uuid().nullable().optional(),
  tempMin: z.number().nullable().optional(),
  tempMax: z.number().nullable().optional(),
  capaciteUnite: z.enum(CAPACITE_UNITES).nullable().optional(),
  capaciteValeur: z.number().min(0).nullable().optional(),
});

export const updateStockLocationSchema = createStockLocationSchema.partial();
