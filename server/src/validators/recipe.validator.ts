import { z } from 'zod';

const etapeSchema = z.object({
  ordre: z.number().int().min(1),
  nom: z.string().min(1, 'Le nom de l\'étape est requis').max(200),
  duree_estimee_min: z.number().positive().nullable().optional(),
  est_bloquante: z.boolean().default(true),
  timer_auto: z.boolean().default(false),
  controle_qualite: z.boolean().default(false),
  checklist_items: z.array(z.string()).default([]),
  est_repetable: z.boolean().default(false),
  nb_repetitions: z.number().int().min(1).default(1),
  responsable_role: z.string().max(50).nullable().optional(),
});

export const createRecipeSchema = z.object({
  name: z.string().min(1, 'Le nom est requis').max(200),
  productId: z.string().uuid().optional().nullable(),
  contenantId: z.string().uuid().optional().nullable(),
  // Classification operationnelle (recipe_categories.id). Distincte de la
  // categorie commerciale du produit lie.
  categoryId: z.string().uuid().optional().nullable(),
  instructions: z.string().optional().nullable(),
  yieldQuantity: z.number().positive('Le rendement doit être positif').default(1),
  yieldUnit: z.string().max(20).default('unit'),
  // Poids unitaire d'une piece, en kg. Requis quand yield_unit != products.sale_unit
  // (la validation finale est faite dans le repository via ensureYieldUnitCompatible).
  pieceWeightKg: z.number().positive('Le poids unitaire doit être positif').nullable().optional(),
  marginMultiplier: z.number().positive('Le multiplicateur doit être positif').default(3),
  salePrice: z.number().nonnegative('Le prix de vente doit être positif').optional().nullable(),
  // Frais indirects au niveau recette (default 0 si absent — preserve le comportement existant)
  tauxMainOeuvreDhH: z.number().nonnegative().optional(),
  coutEnergieFournee: z.number().nonnegative().optional(),
  tauxFraisStructurePct: z.number().min(0).max(100).optional(),
  isBase: z.boolean().default(false),
  etapes: z.array(etapeSchema).default([]),
  ingredients: z.array(z.object({
    ingredientId: z.string().uuid('ID ingrédient invalide'),
    quantity: z.number().positive('La quantité doit être positive'),
    unit: z.string().max(20).optional().nullable(),
  })).min(0),
  subRecipes: z.array(z.object({
    subRecipeId: z.string().uuid('ID sous-recette invalide'),
    quantity: z.number().positive('La quantité doit être positive'),
  })).default([]),
  packaging: z.array(z.object({
    packagingId: z.string().uuid('ID emballage invalide'),
    quantity: z.number().positive('La quantité doit être positive'),
    unit: z.string().max(20).optional().nullable(),
  })).default([]),
  // Formats de production (multi-formats par recette). Optionnel — si vide ou absent,
  // le calcul de cout/format se fait sur recipes.contenant_id (compat descendante).
  formats: z.array(z.object({
    contenantId: z.string().uuid('ID contenant invalide'),
    quantiteParFormatG: z.number().positive('La quantité par format doit être > 0'),
    quantiteParFormatUnite: z.enum(['g', 'kg', 'ml', 'l']).default('g'),
    nbParDefaut: z.number().int().positive('Le nombre par défaut doit être >= 1').default(1),
    coutEmballageUnitaire: z.number().nonnegative().default(0),
    ordre: z.number().int().nonnegative().default(0),
    // Overrides (mig 168) — null = utilise le calcul auto cout × marge_recette
    prixVenteUnitaireOverride: z.number().positive().nullable().optional(),
    marginMultiplierOverride: z.number().positive().nullable().optional(),
  })).default([]),
});

// En édition unifiée, le formulaire n'envoie que les métadonnées (la composition/les
// formats sont gérés par l'éditeur) → ingredients devient optionnel à la mise à jour.
export const updateRecipeSchema = createRecipeSchema.partial({ ingredients: true });
