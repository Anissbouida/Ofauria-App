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
  // En-tête d'ordre (M2-02).
  orderTypeId: uuid.optional().nullable(),
  priority: z.number().int().min(1).max(5).optional().nullable(),
  plannedStart: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)).optional().nullable(),
  plannedEnd: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)).optional().nullable(),
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
      /** M4-06 : type de sortie (défaut : principal / co-produit selon le produit). */
      outputType: z.enum(['principal', 'co_produit', 'sous_produit', 'dechet_valorise']).optional(),
      fixedUnitValue: z.number().finite().min(0).max(1000000).nullable().optional(),
    })).max(20).optional(),
    /** M9 : numéros de série saisis (article suivi par série) ; le reste est numéroté d'après le lot. */
    serials: z.array(z.string().trim().min(1).max(80)).max(5000).optional(),
  })).min(1, 'Aucun article à produire'),
  producedAt: clientTimestamp.optional(),
  // G0-24 : saisies de la fenêtre de lancement, enregistrées avec la déclaration.
  /** Observation libre du chef. */
  observations: z.string().trim().max(2000).optional(),
  /** Bases partagées : quantité réellement produite, ou « déjà produite ». */
  bases: z.array(z.object({
    subRecipeId: uuid,
    actualQuantity: z.number().finite().min(0).max(1_000_000),
    alreadyProduced: z.boolean().optional(),
  })).max(100).optional(),
  /** Pertes constatées à la déclaration (prévu − produit), créées dans la même transaction. */
  losses: z.array(z.object({
    planItemId: uuid,
    quantity: z.number().finite().positive().max(1_000_000),
    reason: z.string().trim().min(1).max(60),
    reasonNote: z.string().trim().max(500).optional(),
  })).max(200).optional(),
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

/**
 * M1-04 — pose ou retire une politique de production à un niveau. Les champs de `value`
 * sont contrôlés ensuite contre le catalogue (type, bornes) par setPolicy.
 */
export const setPolicySchema = z.object({
  scopeType: z.enum(['company', 'store', 'workshop', 'order_type', 'product']),
  scopeId: z.string().max(80).default(''),
  value: z.record(z.string(), z.union([z.number(), z.string().max(40), z.boolean()])).nullable(),
});

/** Types d'ordre de fabrication (M2-01). */
const orderTypeFields = {
  label: z.string().trim().min(1).max(80),
  description: z.string().max(1000).optional().nullable(),
  requiresBonSortie: z.boolean().optional(),
  requiresWeighing: z.boolean().optional(),
  requiresQualityCheck: z.boolean().optional(),
  isSubcontracting: z.boolean().optional(),
  consumptionMode: z.enum(['au_bon_de_sortie', 'a_la_declaration', 'manuel']).optional(),
  defaultTargetRole: z.string().max(30).optional().nullable(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(9999).optional(),
};
export const createOrderTypeSchema = z.object({ code: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_]{1,29}$/, 'Code invalide'), ...orderTypeFields });
export const updateOrderTypeSchema = z.object({ ...orderTypeFields, label: orderTypeFields.label.optional() });

/** Priorité et fenêtre planifiée d'un ordre (M2-02). */
export const updatePlanHeaderSchema = z.object({
  priority: z.number().int().min(1).max(5).optional(),
  plannedStart: z.string().min(10).optional().nullable(),
  plannedEnd: z.string().min(10).optional().nullable(),
});

/** Validation des propositions du calcul des besoins phasé (G5-04). */
export const mrpPhasedValidateSchema = z.object({
  picks: z.array(z.object({
    kind: z.enum(['product', 'ingredient']),
    id: uuid,
    qty: z.number().finite().positive(),
    unit: z.string().max(20),
    releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    needDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })).min(1).max(500),
});

/** Plan directeur enregistré (G5-05) : quantity null = retour à la prévision. */
export const masterScheduleSchema = z.object({
  entries: z.array(z.object({
    productId: uuid,
    weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    quantity: z.number().finite().min(0).nullable(),
  })).min(1).max(5000),
});

/** Nomenclature d'une ligne d'ordre (M4-04) : fiche alternative du produit, ou null. */
export const itemRecipeSchema = z.object({ recipeId: uuid.nullable() });

/** Écrans de fabrication (mig 591) : masquer un élément pour la société (null) ou un type d'ordre. */
export const screenSettingSchema = z.object({
  orderTypeId: uuid.nullable(),
  key: z.string().min(1).max(40),
  hidden: z.boolean(),
});

/** Désassemblage (M9) : pièces d'un lot de produit fini défaites, matières remises en stock. */
export const disassemblySchema = z.object({
  productLotId: uuid,
  quantity: z.number().finite().positive().max(100000),
  recoveryPct: z.number().finite().min(0.01).max(100).optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

/** Sous-traitance (M9) : sous-traitant et prix de façon par unité. */
export const subcontractSetupSchema = z.object({
  supplierId: uuid,
  unitFee: z.number().finite().min(0).max(1_000_000).nullable(),
});
export const subcontractShipSchema = z.object({ notes: z.string().trim().max(1000).optional().nullable() });

/** Gabarit d'impression du module (M8-04) : null = revenir à l'héritage pour ce champ. */
export const printTemplateSchema = z.object({
  title: z.string().trim().max(120).optional().nullable(),
  columns: z.array(z.string().max(40)).max(30).optional().nullable(),
  signatures: z.array(z.string().trim().max(60)).max(6).optional().nullable(),
  footer: z.string().max(300).optional().nullable(),
});
