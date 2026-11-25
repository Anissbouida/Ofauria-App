import { z } from 'zod';
import { STOCK_LOCATION_ROLE_KEYS } from '@ofauria/shared';

// Règles inchangées ; messages en français (plan pilote, étape 3).
const CAPACITE_UNITES = ['bac', 'plaque', 'kg'] as const;
const optId = z.string().guid('Identifiant invalide').nullable().optional();
const optNum = z.number({ error: 'Nombre invalide' }).nullable().optional();

export const createStockLocationSchema = z.object({
  storeId: optId,
  code: z.string({ error: 'Code requis' }).min(1, 'Code requis').max(30, 'Code trop long (30 caractères)'),
  name: z.string({ error: 'Nom requis' }).min(1, 'Nom requis').max(120, 'Nom trop long (120 caractères)'),
  // Mig 699 : code du référentiel stock_location_types (contrôlé en base).
  type: z.string({ error: 'Type d\'emplacement requis' }).regex(/^[a-z0-9_]{1,30}$/, 'Type d\'emplacement inconnu'),
  // Étape 8 multi-industries : rôle métier (déduit du type s'il est absent) et emplacement par défaut du rôle.
  role: z.enum(STOCK_LOCATION_ROLE_KEYS as [string, ...string[]], { error: 'Rôle d\'emplacement inconnu' }).optional(),
  roleDefault: z.boolean().optional(),
  parentId: optId,
  equipementId: optId,
  tempMin: optNum,
  tempMax: optNum,
  capaciteUnite: z.enum(CAPACITE_UNITES, { error: 'Unité de capacité inconnue' }).nullable().optional(),
  capaciteValeur: z.number({ error: 'Capacité invalide' }).min(0, 'Capacité négative').nullable().optional(),
});

export const updateStockLocationSchema = createStockLocationSchema.partial();
