import { db } from '../config/database.js';

/**
 * Sorties déclarées d'une fiche (M4-06) : co-produits (clé = pièces équivalentes),
 * sous-produits et déchets valorisés (prix fixe déduit du coût). Proposées à la
 * déclaration de production ; la quantité réelle se saisit toujours à la déclaration.
 */
export const recipeOutputRepository = {
  async list(recipeId: string) {
    return (await db.query(
      `SELECT ro.*, p.name AS product_name FROM recipe_outputs ro JOIN products p ON p.id = ro.product_id
        WHERE ro.recipe_id = $1 ORDER BY ro.sort_order, p.name`, [recipeId])).rows;
  },
  async upsert(recipeId: string, d: { productId: string; outputType: 'co_produit' | 'sous_produit' | 'dechet_valorise'; quantityPerUnit?: number | null; equivPieces?: number | null; fixedUnitValue?: number | null; sortOrder?: number }) {
    const own = (await db.query(`SELECT product_id FROM recipes WHERE id = $1`, [recipeId])).rows[0];
    if (!own) throw new Error('Fiche introuvable');
    if (own.product_id && own.product_id === d.productId) throw new Error('Le produit de la fiche est la sortie principale');
    if (d.outputType === 'co_produit' && !(Number(d.equivPieces) > 0)) throw new Error('Un co-produit a une équivalence en pièces');
    if (d.outputType !== 'co_produit' && d.fixedUnitValue == null) throw new Error('Un sous-produit a une valeur unitaire fixe');
    return (await db.query(
      `INSERT INTO recipe_outputs (recipe_id, product_id, output_type, quantity_per_unit, equiv_pieces, fixed_unit_value, sort_order)
       VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6::numeric, $7::int)
       ON CONFLICT (recipe_id, product_id, output_type) DO UPDATE SET
         quantity_per_unit = EXCLUDED.quantity_per_unit, equiv_pieces = EXCLUDED.equiv_pieces,
         fixed_unit_value = EXCLUDED.fixed_unit_value, sort_order = EXCLUDED.sort_order
       RETURNING *`,
      [recipeId, d.productId, d.outputType, d.quantityPerUnit ?? null, d.outputType === 'co_produit' ? d.equivPieces : null,
       d.outputType === 'co_produit' ? null : d.fixedUnitValue, d.sortOrder ?? 0])).rows[0];
  },
  async remove(id: string) {
    return (await db.query(`DELETE FROM recipe_outputs WHERE id = $1`, [id])).rowCount! > 0;
  },
};
