import type { Ingredient } from './inventory.types.js';

export interface RecipeIngredient {
  id: number;
  recipeId: string;
  ingredientId: string;
  ingredient?: Ingredient;
  quantity: number;
}

/** Format de production d'une recette (multi-formats par recette).
 *  Une recette de pate peut produire simultanement plusieurs formats
 *  (ex: Cake Nature -> 3 moules moyens 600g + 3 petits 300g). */
export interface RecipeFormat {
  id: string;
  contenantId: string;
  contenantNom?: string;
  contenantUniteLancement?: string;
  contenantType?: number | null;
  quantiteParFormatG: number;
  nbParDefaut: number;
  coutEmballageUnitaire: number;
  ordre: number;
  isActive: boolean;
  // Valeurs calculees par la vue v_recipe_format_cost (lecture seule)
  poidsFormatG?: number;
  poidsUtiliseG?: number;
  coutMatiereFormat?: number;
  coutMatiereUnitaire?: number;
  coutUnitaireComplet?: number;
  prixVenteUnitaire?: number;
}

export interface Recipe {
  id: string;
  productId: string;
  name: string;
  instructions?: string;
  yieldQuantity: number;
  totalCost: number;
  ingredients?: RecipeIngredient[];
  formats?: RecipeFormat[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateRecipeRequest {
  productId: string;
  name: string;
  instructions?: string;
  yieldQuantity?: number;
  ingredients: { ingredientId: string; quantity: number }[];
  formats?: {
    contenantId: string;
    quantiteParFormatG: number;
    nbParDefaut: number;
    coutEmballageUnitaire?: number;
    ordre?: number;
  }[];
}
