import { z } from 'zod';

// Règles inchangées ; messages en français (plan pilote, étape 3).
const LOCATION_TYPES = ['sec', 'positif', 'negatif', 'pesage', 'vitrine', 'labo'] as const;
const CAPACITE_UNITES = ['bac', 'plaque', 'kg'] as const;
const optId = z.string().uuid('Identifiant invalide').nullable().optional();
const optNum = z.number({ invalid_type_error: 'Nombre invalide' }).nullable().optional();

export const createStockLocationSchema = z.object({
  storeId: optId,
  code: z.string({ required_error: 'Code requis' }).min(1, 'Code requis').max(30, 'Code trop long (30 caractères)'),
  name: z.string({ required_error: 'Nom requis' }).min(1, 'Nom requis').max(120, 'Nom trop long (120 caractères)'),
  type: z.enum(LOCATION_TYPES, { errorMap: () => ({ message: 'Type d\'emplacement inconnu' }) }),
  parentId: optId,
  equipementId: optId,
  tempMin: optNum,
  tempMax: optNum,
  capaciteUnite: z.enum(CAPACITE_UNITES, { errorMap: () => ({ message: 'Unité de capacité inconnue' }) }).nullable().optional(),
  capaciteValeur: z.number({ invalid_type_error: 'Capacité invalide' }).min(0, 'Capacité négative').nullable().optional(),
});

export const updateStockLocationSchema = createStockLocationSchema.partial();
