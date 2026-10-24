import { z } from 'zod';

// Validation des entrées du module Production (lot 2). Avant, aucune des 23
// routes /production ne validait son corps : quantités négatives, dates
// quelconques et identifiants malformés arrivaient jusqu'à Postgres (500).

const uuid = z.string().uuid('Identifiant invalide');
const quantity = z.number().finite().positive('La quantité doit être strictement positive');

/** Horodatage fourni par le poste (lancement / fin de production).
 *  Le champ <input type="datetime-local"> envoie « 2026-10-03T15:17 » : ni
 *  secondes ni fuseau. On accepte donc ce format court comme l'ISO complet
 *  (une 1re version n'acceptait que l'ISO avec fuseau et refusait tout
 *  enregistrement : « Invalid datetime »).
 *  Bornes larges, independantes du fuseau du serveur : au plus 26 h dans le
 *  futur, au plus 31 jours dans le passe. */
const clientTimestamp = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?$/, 'Date et heure invalides')
  .refine((v) => {
    const t = new Date(v).getTime();
    if (Number.isNaN(t)) return false;
    const now = Date.now();
    return t <= now + 26 * 3600_000 && t >= now - 31 * 86400_000;
  }, 'Date et heure hors plage (pas dans le futur, 31 jours maximum dans le passé)');

export const createPlanSchema = z.object({
  planDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Date invalide'),
  type: z.enum(['daily', 'weekly']).optional(),
  notes: z.string().max(2000).optional().nullable(),
  targetRole: z.string().max(40).optional().nullable(),
  items: z.array(z.object({
    productId: uuid,
    plannedQuantity: quantity,
    formatId: uuid.optional().nullable(),
    nbContenants: z.number().int().positive().optional().nullable(),
    contenantId: uuid.optional().nullable(),
  }).passthrough()).min(1, 'Au moins un article'),
}).passthrough();

export const updateItemsSchema = z.object({
  items: z.array(z.object({
    productId: uuid,
    plannedQuantity: quantity,
  }).passthrough()).min(1, 'Au moins un article'),
});

export const itemIdsSchema = z.object({
  itemIds: z.array(uuid).min(1, 'Aucun article sélectionné'),
});

export const startItemsSchema = itemIdsSchema.extend({
  startedAt: clientTimestamp.optional(),
});

export const produceItemsSchema = z.object({
  items: z.array(z.object({
    planItemId: uuid,
    actualQuantity: z.number().finite().min(0),
    /** Coupe (mig 302) : ce que le chef a sorti du cadre. productId absent/null =
     *  le produit de l'article (vaut 1). Sinon un autre produit du catalogue avec
     *  son équivalence en pièces de l'article (un entremets = 8 tranches).
     *  Absent = production sans découpe. */
    outputs: z.array(z.object({
      productId: uuid.nullable().optional(),
      equivPieces: z.number().finite().positive().max(1000).optional(),
      quantity: z.number().finite().min(0).max(100000),
    })).max(20).optional(),
  })).min(1, 'Aucun article à produire'),
  producedAt: clientTimestamp.optional(),
});

export const completeSchema = z.object({
  items: z.array(z.object({
    planItemId: uuid,
    actualQuantity: z.number().finite().min(0),
  })).optional().default([]),
  completionType: z.enum(['complete', 'partial']).optional(),
});

export const cancelItemsSchema = itemIdsSchema.extend({
  reason: z.string().trim().max(500).optional(),
});

export const relaunchSchema = z.object({
  itemIds: z.array(uuid).optional(),
});

export const addActivitySchema = z.object({
  message: z.string().trim().min(1, 'Message requis').max(2000),
});

export const requestStockVerificationSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

export const listQuerySchema = z.object({
  status: z.string().max(40).optional(),
  type: z.enum(['daily', 'weekly']).optional(),
  dateFrom: z.string().max(10).optional(),
  dateTo: z.string().max(10).optional(),
  targetRole: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});
