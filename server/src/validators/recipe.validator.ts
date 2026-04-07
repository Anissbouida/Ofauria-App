import { z } from 'zod';

export const createRecipeSchema = z.object({
  name: z.string().min(1, 'Le nom est requis').max(200),
  productId: z.string().uuid().optional().nullable(),
  instructions: z.string().optional().nullable(),
  yieldQuantity: z.number().positive('Le rendement doit être positif').default(1),
  isBase: z.boolean().default(false),
  ingredients: z.array(z.object({
    ingredientId: z.string().uuid('ID ingrédient invalide'),
    quantity: z.number().positive('La quantité doit être positive'),
  })).min(0),
  subRecipes: z.array(z.object({
    subRecipeId: z.string().uuid('ID sous-recette invalide'),
    quantity: z.number().positive('La quantité doit être positive'),
  })).default([]),
});

export const updateRecipeSchema = createRecipeSchema;
