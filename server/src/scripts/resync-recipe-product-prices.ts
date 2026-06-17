/**
 * Re-sync products.cost_price et products.price (ou price_per_kg selon sale_unit)
 * pour toutes les recettes ayant un produit lie. A executer apres la mig 174
 * (deduplication recipe_ingredients) car les anciens cost_price ont ete calcules
 * avec un cout matiere double (doublons d'ingredients).
 *
 * Usage : npx tsx server/src/scripts/resync-recipe-product-prices.ts
 */

import { db } from '../config/database.js';
import { recipeRepository } from '../repositories/recipe.repository.js';

async function run() {
  console.log('→ Re-sync des prix products depuis les recettes...');
  const result = await db.query(
    `SELECT r.id, r.name, r.product_id, r.yield_quantity, r.yield_unit, r.piece_weight_kg,
            r.margin_multiplier, vtc.total_cost
     FROM recipes r
     JOIN v_recipe_total_cost vtc ON vtc.id = r.id
     WHERE r.product_id IS NOT NULL AND r.is_base = false
     ORDER BY r.name`,
  );

  let ok = 0;
  let skipped = 0;
  let errors = 0;
  for (const r of result.rows) {
    try {
      const totalCost = parseFloat(r.total_cost || '0');
      const yieldQty = parseFloat(r.yield_quantity || '1');
      const margin = parseFloat(r.margin_multiplier || '3');
      const yieldUnit = r.yield_unit || 'unit';
      const pieceWeightKg = r.piece_weight_kg !== null && r.piece_weight_kg !== undefined
        ? parseFloat(r.piece_weight_kg) : null;
      if (totalCost <= 0 || yieldQty <= 0) {
        skipped++;
        continue;
      }
      await recipeRepository.syncProductPrice(
        db,
        r.product_id,
        totalCost,
        yieldQty,
        yieldUnit,
        pieceWeightKg,
        margin,
      );
      ok++;
    } catch (err: unknown) {
      errors++;
      console.error(`  ✗ ${r.name} : ${(err as Error).message}`);
    }
  }

  console.log(`\n✓ Re-sync termine : ${ok} OK, ${skipped} sautes (cout 0), ${errors} erreurs.`);
  process.exit(0);
}

run().catch(err => {
  console.error('Erreur fatale :', err);
  process.exit(1);
});
