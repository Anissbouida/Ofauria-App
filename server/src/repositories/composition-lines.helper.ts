import type pg from 'pg';
import { unitIdSql } from '../utils/qty-unit.js';

/**
 * Étape 2 bis, pas 2b-1 : l'ancien modèle de fiche (recipe_ingredients, recipe_sub_recipes,
 * recipe_packaging) n'est plus écrit. Les appels qui reçoivent encore des lignes « à plat »
 * (API de création et de modification, import de fiches, données de départ, simulation,
 * restauration d'une ancienne version) les écrivent ici dans la nomenclature du format par
 * défaut — la seule composition lue par les coûts, les besoins et les allergènes.
 *
 * Le miroir recipe_components est reconstruit par trigger (mig 412) et l'anti-cycle des
 * composants de format est assuré par trigger (mig 410). La fonction n'ouvre pas de
 * transaction : elle s'exécute sur le client fourni, dans la transaction de l'appelant.
 */
export interface LineIngredient { ingredientId: string; quantity: number; unit?: string | null }
export interface LineSubRecipe { subRecipeId: string; quantity: number }
export interface LinePackaging { packagingId: string; quantity: number; unit?: string | null }
export interface CompositionLines {
  ingredients?: LineIngredient[];
  subRecipes?: LineSubRecipe[];
  packaging?: LinePackaging[];
}

type Queryable = Pick<pg.PoolClient, 'query'>;

export const hasCompositionLines = (l: CompositionLines | null | undefined): boolean =>
  !!l && ((l.ingredients?.length ?? 0) + (l.subRecipes?.length ?? 0) + (l.packaging?.length ?? 0)) > 0;

/** Format par défaut actif de la fiche ; créé (sans contenant) s'il n'existe pas. */
export async function ensureDefaultFormat(client: Queryable, recipeId: string, userId: string | null = null): Promise<string> {
  const cur = await client.query(
    `SELECT id FROM recipe_formats WHERE recipe_id = $1 AND is_default ORDER BY is_active DESC LIMIT 1`, [recipeId]);
  if (cur.rows[0]) {
    await client.query(`UPDATE recipe_formats SET is_active = true WHERE id = $1 AND NOT is_active`, [cur.rows[0].id]);
    return cur.rows[0].id as string;
  }
  const r = await client.query(
    `INSERT INTO recipe_formats (recipe_id, contenant_id, quantite_par_format, quantite_par_format_unite,
                                 nb_par_defaut, cout_emballage_unitaire, is_default, ordre, is_active, updated_by)
     VALUES ($1, NULL, 1, 'g', 1, 0, true, COALESCE((SELECT MAX(ordre) + 1 FROM recipe_formats WHERE recipe_id = $1), 0), true, $2)
     RETURNING id`, [recipeId, userId]);
  return r.rows[0].id as string;
}

/**
 * Remplace la nomenclature du format par défaut par les lignes fournies.
 * Matière → rôle « matiere » (unité saisie, à défaut celle du stock) ; sous-recette →
 * « semi_fini » (quantité exprimée dans l'unité de rendement de la sous-recette, comme dans
 * l'ancien modèle) ; emballage → « emballage ». La fiche passe en mode composé.
 * Sans aucune ligne, rien n'est touché.
 */
export async function writeCompositionLines(
  client: Queryable, recipeId: string, lines: CompositionLines, userId: string | null = null,
): Promise<string | null> {
  if (!hasCompositionLines(lines)) return null;
  const formatId = await ensureDefaultFormat(client, recipeId, userId);
  await client.query(`DELETE FROM recipe_format_components WHERE format_id = $1`, [formatId]);

  let ordre = 0;
  const insert = (role: string, src: { recipe?: string; ingredient?: string; packaging?: string }, qty: number, unit: string) =>
    client.query(
      `INSERT INTO recipe_format_components
         (format_id, role, source_recipe_id, source_ingredient_id, source_packaging_id, quantite, unite, unit_id, perte_pct, ordre, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::varchar, ${unitIdSql('$7::varchar')}, 0, $8, $9)`,
      [formatId, role, src.recipe ?? null, src.ingredient ?? null, src.packaging ?? null, qty, unit, ordre++, userId]);

  for (const l of lines.ingredients ?? []) {
    const unit = l.unit || (await client.query(`SELECT unit FROM ingredients WHERE id = $1`, [l.ingredientId])).rows[0]?.unit || 'g';
    await insert('matiere', { ingredient: l.ingredientId }, Number(l.quantity), unit);
  }
  for (const l of lines.subRecipes ?? []) {
    const unit = (await client.query(`SELECT yield_unit FROM recipes WHERE id = $1`, [l.subRecipeId])).rows[0]?.yield_unit || 'unit';
    await insert('semi_fini', { recipe: l.subRecipeId }, Number(l.quantity), unit);
  }
  for (const l of lines.packaging ?? []) {
    await insert('emballage', { packaging: l.packagingId }, Number(l.quantity), l.unit || 'unit');
  }

  await client.query(`UPDATE recipes SET mode_cout = 'compose', updated_at = NOW() WHERE id = $1 AND mode_cout IS DISTINCT FROM 'compose'`, [recipeId]);
  return formatId;
}
