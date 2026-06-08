import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { db } from '../config/database.js';
import {
  parseIngredientWorkbook,
  generateIngredientWorkbook,
  INGREDIENT_CATEGORIES,
  type ParsedIngredientRow,
} from '../services/ingredient-excel.service.js';

type IngredientPlanRow = {
  sourceRow: number;
  name: string;
  category: string;
  unit: string;
  unitCost: number;
  supplier: string | null;
  allergens: string[];
  existingId: string | null;
  unitCostChanged?: boolean;   // pour les updates : declenche cascade prix
  changes?: string[];          // liste de champs modifies (info preview)
};

interface IngredientPlan {
  toCreate: IngredientPlanRow[];
  toUpdate: IngredientPlanRow[];
  unchanged: IngredientPlanRow[];
}

/**
 * Construit le plan d'import : pour chaque ligne du fichier, decide
 * creation vs mise a jour selon le nom (case-insensitive).
 */
async function buildPlan(rows: ParsedIngredientRow[]): Promise<IngredientPlan> {
  const existingByName = new Map<string, {
    id: string; category: string | null; unit: string;
    unit_cost: string | number; supplier: string | null; allergens: string[] | null;
  }>();
  const allRes = await db.query(
    `SELECT id, name, category, unit, unit_cost, supplier, allergens FROM ingredients`
  );
  for (const r of allRes.rows) {
    existingByName.set(String(r.name).trim().toUpperCase(), r);
  }

  const toCreate: IngredientPlanRow[] = [];
  const toUpdate: IngredientPlanRow[] = [];
  const unchanged: IngredientPlanRow[] = [];

  for (const row of rows) {
    const existing = existingByName.get(row.name.toUpperCase());
    if (!existing) {
      toCreate.push({ ...row, existingId: null });
      continue;
    }

    // Diff : on compare les champs source
    const changes: string[] = [];
    const existingCost = parseFloat(String(existing.unit_cost || '0')) || 0;
    if ((existing.category || 'autre') !== row.category) changes.push('categorie');
    if (existing.unit !== row.unit) changes.push('unite');
    if (Math.abs(existingCost - row.unitCost) > 0.0001) changes.push('cout');
    if ((existing.supplier || '') !== (row.supplier || '')) changes.push('fournisseur');
    const existingAllergens = (existing.allergens || []).join('|');
    const newAllergens = (row.allergens || []).join('|');
    if (existingAllergens !== newAllergens) changes.push('allergenes');

    if (changes.length === 0) {
      unchanged.push({ ...row, existingId: existing.id });
    } else {
      toUpdate.push({
        ...row,
        existingId: existing.id,
        unitCostChanged: changes.includes('cout'),
        changes,
      });
    }
  }

  return { toCreate, toUpdate, unchanged };
}

export const ingredientImportController = {
  /**
   * GET /api/v1/ingredients/export
   * Genere un xlsx avec la liste des ingredients + stock courant.
   */
  async export(req: AuthRequest, res: Response) {
    const storeId = req.user!.storeId || null;
    // Reutilise la requete inventory complete (avec stock + DLC).
    const where = storeId ? 'WHERE inv.store_id = $1' : '';
    const lotStoreFilter = storeId ? 'AND store_id = $1' : '';
    const params = storeId ? [storeId] : [];
    const result = await db.query(
      `WITH lot_stats AS (
         SELECT ingredient_id,
                COALESCE(SUM(economat_quantity), 0) AS economat_quantity,
                COALESCE(SUM(pesage_quantity), 0) AS pesage_quantity,
                COUNT(*) FILTER (WHERE quantity_remaining > 0) AS active_lots_count,
                MIN(expiration_date) FILTER (WHERE quantity_remaining > 0 AND expiration_date IS NOT NULL) AS nearest_dlc
         FROM ingredient_lots
         WHERE status = 'active' ${lotStoreFilter}
         GROUP BY ingredient_id
       )
       SELECT ing.name, ing.category, ing.unit, ing.unit_cost, ing.supplier, ing.allergens,
              COALESCE(inv.current_quantity, 0) AS current_quantity,
              COALESCE(ls.economat_quantity, 0) AS economat_quantity,
              COALESCE(ls.pesage_quantity, 0) AS pesage_quantity,
              COALESCE(ls.active_lots_count, 0) AS active_lots_count,
              ls.nearest_dlc
       FROM ingredients ing
       LEFT JOIN inventory inv ON inv.ingredient_id = ing.id
       LEFT JOIN lot_stats ls ON ls.ingredient_id = ing.id
       ${where}
       ORDER BY ing.category, ing.name`,
      params
    );

    const items = result.rows.map(r => ({
      name: r.name,
      category: r.category,
      unit: r.unit,
      unitCost: parseFloat(String(r.unit_cost || '0')) || 0,
      supplier: r.supplier,
      allergens: r.allergens,
      totalStock: parseFloat(String(r.current_quantity || '0')) || 0,
      economat: parseFloat(String(r.economat_quantity || '0')) || 0,
      pesage: parseFloat(String(r.pesage_quantity || '0')) || 0,
      activeLots: parseInt(String(r.active_lots_count || '0'), 10) || 0,
      nearestDlc: r.nearest_dlc
        ? new Date(r.nearest_dlc).toISOString().slice(0, 10)
        : null,
    }));

    const buffer = generateIngredientWorkbook(items, { includeStock: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `ingredients-economat-${stamp}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  },

  /**
   * POST /api/v1/ingredients/import/preview
   * Analyse le xlsx, retourne plan (create/update/unchanged) + erreurs.
   */
  async preview(req: AuthRequest, res: Response) {
    if (!req.file) {
      res.status(400).json({ success: false, error: { message: 'Aucun fichier envoye' } });
      return;
    }
    try {
      const parsed = parseIngredientWorkbook(req.file.buffer);
      const plan = await buildPlan(parsed.rows);

      res.json({
        success: true,
        data: {
          summary: {
            totalRows: parsed.rows.length,
            toCreate: plan.toCreate.length,
            toUpdate: plan.toUpdate.length,
            unchanged: plan.unchanged.length,
            errors: parsed.errors.length,
          },
          toCreate: plan.toCreate.map(r => ({
            sourceRow: r.sourceRow, name: r.name, category: r.category, unit: r.unit,
            unitCost: r.unitCost, supplier: r.supplier, allergens: r.allergens,
          })),
          toUpdate: plan.toUpdate.map(r => ({
            sourceRow: r.sourceRow, name: r.name, category: r.category, unit: r.unit,
            unitCost: r.unitCost, supplier: r.supplier, allergens: r.allergens,
            changes: r.changes || [],
          })),
          errors: parsed.errors,
          warnings: parsed.warnings,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur de parsing';
      res.status(400).json({ success: false, error: { message: msg } });
    }
  },

  /**
   * POST /api/v1/ingredients/import/commit
   * Applique l'import (creation + upsert + cascade prix sur cout modifie).
   */
  async commit(req: AuthRequest, res: Response) {
    if (!req.file) {
      res.status(400).json({ success: false, error: { message: 'Aucun fichier envoye' } });
      return;
    }
    let parsed;
    try {
      parsed = parseIngredientWorkbook(req.file.buffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur de parsing';
      res.status(400).json({ success: false, error: { message: msg } });
      return;
    }
    if (parsed.errors.length > 0) {
      res.status(400).json({
        success: false,
        error: { message: `${parsed.errors.length} erreur(s) de validation — corrigez le fichier avant import` },
      });
      return;
    }
    const plan = await buildPlan(parsed.rows);

    // Multi-store : on cree l'inventaire dans le store de l'utilisateur courant.
    // Sans ca, store_id = NULL et le listing (qui filtre WHERE inv.store_id = $1)
    // n'affiche pas les ingredients importes pour les users avec un storeId.
    const storeId = req.user!.storeId || null;

    const client = await db.getClient();
    let created = 0;
    let updated = 0;
    const cascadeRecipeIds = new Set<string>();
    const errors: { row: number; message: string }[] = [];
    try {
      await client.query('BEGIN');

      // CREATIONS
      for (const row of plan.toCreate) {
        try {
          const ins = await client.query(
            `INSERT INTO ingredients (name, unit, unit_cost, supplier, allergens, category)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [row.name, row.unit, row.unitCost, row.supplier, row.allergens, row.category]
          );
          await client.query(
            `INSERT INTO inventory (ingredient_id, store_id) VALUES ($1, $2)`,
            [ins.rows[0].id, storeId]
          );
          created++;
        } catch (e) {
          errors.push({
            row: row.sourceRow,
            message: e instanceof Error ? e.message : 'Erreur de creation',
          });
        }
      }

      // MISES A JOUR
      for (const row of plan.toUpdate) {
        if (!row.existingId) continue;
        try {
          await client.query(
            `UPDATE ingredients
             SET unit = $1, unit_cost = $2, supplier = $3, allergens = $4, category = $5
             WHERE id = $6`,
            [row.unit, row.unitCost, row.supplier, row.allergens, row.category, row.existingId]
          );
          updated++;
          if (row.unitCostChanged) {
            // Collecte recettes a re-cascader apres commit
            const r = await client.query(
              `SELECT DISTINCT recipe_id FROM recipe_ingredients WHERE ingredient_id = $1`,
              [row.existingId]
            );
            for (const rec of r.rows) cascadeRecipeIds.add(rec.recipe_id as string);
          }
        } catch (e) {
          errors.push({
            row: row.sourceRow,
            message: e instanceof Error ? e.message : 'Erreur de mise a jour',
          });
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      const msg = err instanceof Error ? err.message : 'Erreur lors de l\'import';
      res.status(500).json({ success: false, error: { message: msg } });
      return;
    } finally {
      client.release();
    }

    // Cascade des prix recettes hors transaction (peut etre long, et le repo
    // utilise db.query — pas le client). Idempotent : on tolere les erreurs.
    if (cascadeRecipeIds.size > 0) {
      try {
        const { recipeRepository } = await import('../repositories/recipe.repository.js');
        for (const recipeId of cascadeRecipeIds) {
          try {
            const recipe = await recipeRepository.findById(recipeId);
            if (!recipe) continue;
            const totalCost = parseFloat(recipe.total_cost || '0');
            const margin = parseFloat(recipe.margin_multiplier || '3');
            const yieldQty = parseFloat(recipe.yield_quantity || '1');
            await recipeRepository.syncProductPrice(db, recipe.product_id || null, totalCost, yieldQty, margin);
            await recipeRepository.recalcParents(recipeId);
          } catch (e) {
            console.error('Cascade prix recette echouee', recipeId, e);
          }
        }
      } catch (e) {
        console.error('Cascade prix recettes import ingredients :', e);
      }
    }

    res.json({
      success: true,
      data: {
        created,
        updated,
        unchanged: plan.unchanged.length,
        warnings: parsed.warnings,
        errors,
        cascadedRecipes: cascadeRecipeIds.size,
      },
    });
  },

  /**
   * GET /api/v1/ingredients/import/template
   * Renvoie un xlsx vide (en-tete + 1 ligne d'exemple) pour aider l'utilisateur.
   */
  async template(_req: AuthRequest, res: Response) {
    const example = [{
      name: 'Farine T55',
      category: 'farines',
      unit: 'kg',
      unitCost: 8.5,
      supplier: 'SONEPAL',
      allergens: ['gluten'],
    }];
    const buffer = generateIngredientWorkbook(example, { includeStock: false });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ingredients-modele-import.xlsx"`);
    res.setHeader('Content-Length', String(buffer.length));
    // Petit log inutile evite — INGREDIENT_CATEGORIES expose pour la doc
    void INGREDIENT_CATEGORIES;
    res.send(buffer);
  },
};
