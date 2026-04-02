import type { Ingredient } from './inventory.types.js';

export interface RecipeIngredient {
  id: number;
  recipeId: string;
  ingredientId: string;
  ingredient?: Ingredient;
  quantity: number;
}

export interface Recipe {
  id: string;
  productId: string;
  name: string;
  instructions?: string;
  yieldQuantity: number;
  totalCost: number;
  ingredients?: RecipeIngredient[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateRecipeRequest {
  productId: string;
  name: string;
  instructions?: string;
  yieldQuantity?: number;
  ingredients: { ingredientId: string; quantity: number }[];
}
