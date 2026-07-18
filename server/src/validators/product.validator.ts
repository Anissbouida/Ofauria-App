import { z } from 'zod';

// ─── Cycle de vie produit — audit V1 ──────────────────────────────────────
// Objectif : rendre le paramétrage cohérent AVANT enregistrement.
//
// Règles métier issues de l'audit :
//   - sale_type ∈ { jour, dlv, commande }
//   - type=dlv  ⇒ shelf_life_days > 0 obligatoire
//   - type=commande ⇒ pas de cycle de vie (shelf/display/reexpose/recycle purgés)
//   - is_reexposable=true ⇒ max_reexpositions ≥ 1 (fin du 0 silencieusement
//     réinterprété en 1 côté computeSuggestion)
//   - is_recyclable=true  ⇒ soit recycleIngredientId, soit au moins une
//     destination active (côté endpoint destinations)
//
// Le formulaire client purge déjà les champs incohérents au changement de type
// mais on redouble la validation ici : rien ne doit passer par un appel API
// direct qui casserait les invariants.

const uuid = z.string().uuid('Identifiant UUID invalide');

const SALE_TYPES = ['jour', 'dlv', 'commande'] as const;
export const saleTypeSchema = z.enum(SALE_TYPES);

const positiveInt = (max: number, msg: string) =>
  z.coerce.number().int().min(0, msg).max(max, msg);

// Champs communs cycle de vie — tous optionnels au niveau schema, les règles
// croisées sont dans le .superRefine plus bas.
const lifecycleFields = {
  saleType: saleTypeSchema.optional(),
  shelfLifeDays: positiveInt(365, 'DLV: 0 à 365 jours').optional().nullable(),
  displayLifeHours: positiveInt(24 * 30, 'DDE: 0 à 720 heures').optional().nullable(),
  isReexposable: z.coerce.boolean().optional(),
  isRecyclable: z.coerce.boolean().optional(),
  recycleIngredientId: uuid.nullable().optional(),
  maxReexpositions: positiveInt(10, 'Max ré-expositions: 0 à 10').optional().nullable(),
};

// Base commune create/update — hors cycle de vie
const commonProductFields = {
  name: z.string().trim().min(1, 'Nom requis').max(200, 'Nom trop long'),
  categoryId: z.coerce.number().int().positive('Catégorie requise'),
  description: z.string().trim().max(2000).optional().nullable(),
  price: z.coerce.number().finite().min(0, 'Prix ≥ 0').max(999999.99, 'Prix trop élevé'),
  costPrice: z.coerce.number().finite().min(0).max(999999.99).optional().nullable(),
  isAvailable: z.coerce.boolean().optional(),
  isCustomOrderable: z.coerce.boolean().optional(),
  preparationTimeMin: z.coerce.number().int().min(0).max(10080).optional().nullable(),
  responsibleUserId: uuid.nullable().optional(),
  stockMinThreshold: z.coerce.number().min(0).max(1_000_000).optional().nullable(),
  minProductionQuantity: z.coerce.number().int().min(0).max(1_000_000).optional().nullable(),
  saleUnit: z.enum(['unit', 'weight']).optional(),
  pricePerKg: z.coerce.number().finite().min(0).max(999999.99).optional().nullable(),
};

// Applique les règles croisées de cycle de vie.
// Utilisé sur create + update (partial). Le contract : si un champ n'est pas
// dans le body, on ne l'évalue pas — sauf pour saleType, qui pilote tout.
function refineLifecycle(
  ctx: z.RefinementCtx,
  data: {
    saleType?: 'jour' | 'dlv' | 'commande';
    shelfLifeDays?: number | null;
    displayLifeHours?: number | null;
    isReexposable?: boolean;
    isRecyclable?: boolean;
    recycleIngredientId?: string | null;
    maxReexpositions?: number | null;
  },
) {
  const saleType = data.saleType;

  // Règle 1 : type=dlv ⇒ shelfLifeDays > 0 obligatoire (si explicitement
  // envoyé, ou si type=dlv est nouveau — géré par create). Sur un update
  // qui ne change ni saleType ni shelfLifeDays, on ne peut pas juger, on
  // laisse la CHECK DB attraper.
  if (saleType === 'dlv' && data.shelfLifeDays !== undefined) {
    if (data.shelfLifeDays === null || data.shelfLifeDays <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'DLV obligatoire (> 0 jour) pour un produit de type « DLV »',
        path: ['shelfLifeDays'],
      });
    }
  }

  // Règle 2 : type=commande ⇒ cycle de vie doit être purgé.
  // On tolère null/0/false explicitement — on rejette les valeurs positives.
  if (saleType === 'commande') {
    if (data.shelfLifeDays && data.shelfLifeDays > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Produit « Sur commande » : pas de DLV (jamais en vitrine)',
        path: ['shelfLifeDays'],
      });
    }
    if (data.displayLifeHours && data.displayLifeHours > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Produit « Sur commande » : pas de DDE',
        path: ['displayLifeHours'],
      });
    }
    if (data.isReexposable === true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Produit « Sur commande » ne peut pas être ré-exposable',
        path: ['isReexposable'],
      });
    }
    if (data.isRecyclable === true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Produit « Sur commande » ne peut pas être recyclable',
        path: ['isRecyclable'],
      });
    }
  }

  // Règle 3 : is_reexposable=true ⇒ max_reexpositions ≥ 1.
  // Élimine le silent 0→1 côté moteur : si l'admin veut re-exposable, il fixe
  // le plafond explicitement.
  if (data.isReexposable === true && data.maxReexpositions !== undefined) {
    if (data.maxReexpositions === null || data.maxReexpositions < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Ré-expositions max: ≥ 1 quand le produit est ré-exposable',
        path: ['maxReexpositions'],
      });
    }
  }

  // Règle 4 : is_reexposable=false ⇒ max_reexpositions doit être 0 (ou absent).
  // Sinon on garde un plafond « fantôme » qui perturbe les stats.
  if (data.isReexposable === false && data.maxReexpositions !== undefined && data.maxReexpositions !== null && data.maxReexpositions > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Ré-expositions max: doit être 0 quand le produit n\'est pas ré-exposable',
      path: ['maxReexpositions'],
    });
  }

  // Règle 5 : is_recyclable=true sans destination legacy ⇒ le controller
  // vérifie qu'au moins une product_recycle_destinations existe (fait sur
  // l'endpoint dédié). Ici on laisse passer — l'endpoint destinations est le
  // pilote canonique.
}

// ─── Create ────────────────────────────────────────────────────────────────
// recipeId n'est PAS dans le validator car le controller le manipule séparément
// (transaction UPDATE recipes.product_id). On l'accepte via .passthrough côté
// controller si besoin, mais le validator ne le vérifie pas ici.
export const createProductSchema = z.object({
  ...commonProductFields,
  ...lifecycleFields,
  recipeId: uuid.optional(),
}).superRefine((data, ctx) => refineLifecycle(ctx, data));

// ─── Update ────────────────────────────────────────────────────────────────
// Tous les champs optionnels, recipeId peut être '' (détacher) ou UUID (lier).
export const updateProductSchema = z.object({
  name: commonProductFields.name.optional(),
  categoryId: commonProductFields.categoryId.optional(),
  description: commonProductFields.description,
  price: commonProductFields.price.optional(),
  costPrice: commonProductFields.costPrice,
  imageUrl: z.string().max(500).optional().nullable(),
  isAvailable: commonProductFields.isAvailable,
  isCustomOrderable: commonProductFields.isCustomOrderable,
  preparationTimeMin: commonProductFields.preparationTimeMin,
  responsibleUserId: commonProductFields.responsibleUserId,
  stockMinThreshold: commonProductFields.stockMinThreshold,
  minProductionQuantity: commonProductFields.minProductionQuantity,
  saleUnit: commonProductFields.saleUnit,
  pricePerKg: commonProductFields.pricePerKg,
  stockQuantity: z.coerce.number().min(0).max(1_000_000).optional().nullable(),
  ...lifecycleFields,
  // recipeId : '' = détacher, uuid = lier, undefined = ne rien toucher.
  recipeId: z.union([uuid, z.literal('')]).optional().nullable(),
}).superRefine((data, ctx) => refineLifecycle(ctx, data));

// ─── Destinations de recyclage (P1.3) ─────────────────────────────────────
// Endpoint dédié : PUT /products/:id/recycle-destinations
// Le client envoie la liste complète à chaque appel (remplacement idempotent).
export const recycleDestinationSchema = z.object({
  ingredientId: uuid,
  label: z.string().trim().max(120).optional().nullable(),
  displayOrder: z.coerce.number().int().min(0).max(1000).optional(),
  yieldRatio: z.coerce.number().finite().gt(0, 'Rendement > 0').lte(2, 'Rendement ≤ 2').optional(),
  isActive: z.coerce.boolean().optional(),
});

export const replaceRecycleDestinationsSchema = z.object({
  destinations: z.array(recycleDestinationSchema).max(20, 'Trop de destinations'),
});

// ─── Suppression en masse ──────────────────────────────────────────────────
// POST /products/bulk-delete — admin uniquement. Chaque suppression est
// traitée individuellement côté controller (un produit référencé par des
// ventes échoue sans bloquer les autres).
export const bulkDeleteProductsSchema = z.object({
  ids: z.array(uuid).min(1, 'Aucun produit sélectionné').max(1000, 'Trop de produits'),
});

// ─── Import CSV (export Loyverse) ──────────────────────────────────────────
// POST /products/import — le client parse le CSV et envoie des lignes déjà
// normalisées. Les produits importés n'ont pas de recette (catalogue seul) :
// la recette reste obligatoire uniquement via le formulaire de création.
export const importProductsSchema = z.object({
  items: z.array(z.object({
    name: z.string().trim().min(1, 'Nom requis').max(200, 'Nom trop long'),
    category: z.string().trim().max(100).optional().nullable(),
    price: z.coerce.number().finite().min(0, 'Prix ≥ 0').max(999999.99, 'Prix trop élevé'),
    costPrice: z.coerce.number().finite().min(0).max(999999.99).optional().nullable(),
    saleUnit: z.enum(['unit', 'weight']).optional(),
    isAvailable: z.coerce.boolean().optional(),
  })).min(1, 'Fichier vide').max(2000, 'Trop de lignes (max 2000)'),
});
