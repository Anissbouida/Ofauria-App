import { z } from 'zod';

// Règles inchangées ; messages en français (plan pilote, étape 3).
const LOCATION_TYPES = ['sec', 'positif', 'negatif', 'pesage', 'vitrine', 'labo'] as const;
const CAPACITE_UNITES = ['bac', 'plaque', 'kg'] as const;
const optId = z.string().guid('Identifiant invalide').nullable().optional();
const optNum = z.number({ error: 'Nombre invalide' }).nullable().optional();

export const createStockLocationSchema = z.object({
  storeId: optId,
  code: z.string({ error: 'Code requis' }).min(1, 'Code requis').max(30, 'Code trop long (30 caractères)'),
  name: z.string({ error: 'Nom requis' }).min(1, 'Nom requis').max(120, 'Nom trop long (120 caractères)'),
  type: z.enum(LOCATION_TYPES, { error: 'Type d\'emplacement inconnu' }),
  parentId: optId,
  equipementId: optId,
  tempMin: optNum,
  tempMax: optNum,
  capaciteUnite: z.enum(CAPACITE_UNITES, { error: 'Unité de capacité inconnue' }).nullable().optional(),
  capaciteValeur: z.number({ error: 'Capacité invalide' }).min(0, 'Capacité négative').nullable().optional(),
});

export const updateStockLocationSchema = createStockLocationSchema.partial();
