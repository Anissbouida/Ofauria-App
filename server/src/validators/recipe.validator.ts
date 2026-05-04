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
  instructions: z.string().optional().nullable(),
  yieldQuantity: z.number().positive('Le rendement doit être positif').default(1),
  yieldUnit: z.string().max(20).default('unit'),
  marginMultiplier: z.number().positive('Le multiplicateur doit être positif').default(3),
  salePrice: z.number().nonnegative('Le prix de vente doit être positif').optional().nullable(),
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
});

export const updateRecipeSchema = createRecipeSchema;
