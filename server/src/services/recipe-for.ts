import { db } from '../config/database.js';

/**
 * Nomenclatures d'un produit (M4-04, mig 562). Point d'entrée unique pour « quelle fiche
 * pour ce produit » : la fiche par défaut (recipes.product_id) et les fiches
 * supplémentaires (alternative_for_product_id, usage alternative | sous_traitance).
 */
export type RecipeUsage = 'fabrication' | 'alternative' | 'sous_traitance';
export interface ProductRecipe { id: string; name: string; usage: RecipeUsage; is_default: boolean; archived: boolean }

export async function recipesForProduct(productId: string): Promise<ProductRecipe[]> {
  return (await db.query(
    `SELECT r.id, r.name, r.usage, COALESCE(r.product_id = $1, false) AS is_default, (r.archived_at IS NOT NULL) AS archived
       FROM recipes r
      WHERE r.product_id = $1 OR r.alternative_for_product_id = $1
      ORDER BY COALESCE(r.product_id = $1, false) DESC, r.name`, [productId])).rows;
}

/** Fiche à utiliser : la fiche choisie si elle appartient au produit, sinon celle par défaut. */
export async function getRecipeFor(productId: string, opts: { recipeId?: string | null; usage?: RecipeUsage } = {}): Promise<ProductRecipe | null> {
  const all = (await recipesForProduct(productId)).filter(r => !r.archived);
  if (opts.recipeId) return all.find(r => r.id === opts.recipeId) ?? null;
  if (opts.usage && opts.usage !== 'fabrication') return all.find(r => r.usage === opts.usage) ?? null;
  return all.find(r => r.is_default) ?? null;
}

/** Rattache une fiche comme nomenclature supplémentaire d'un produit (ou la détache). */
export async function setAlternative(recipeId: string, productId: string | null, usage: RecipeUsage) {
  const r = (await db.query(`SELECT id, product_id FROM recipes WHERE id = $1`, [recipeId])).rows[0];
  if (!r) throw new Error('Fiche introuvable');
  if (r.product_id) throw new Error('Cette fiche est la fiche par défaut d\'un produit : elle ne peut pas être une alternative');
  if (productId && usage === 'fabrication') throw new Error('Choisissez l\'usage : alternative ou sous-traitance');
  await db.query(`UPDATE recipes SET alternative_for_product_id = $2, usage = $3, updated_at = now() WHERE id = $1`,
    [recipeId, productId, productId ? usage : 'fabrication']);
  return { recipeId, productId, usage: productId ? usage : 'fabrication' };
}
