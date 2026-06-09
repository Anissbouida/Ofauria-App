import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { db } from '../config/database.js';
import { recipeRepository } from '../repositories/recipe.repository.js';
import {
  parseRecipeWorkbook,
  generateRecipeWorkbook,
  type ParsedRecipesWorkbook,
  type RecipeExportPayload,
} from '../services/recipe-excel.service.js';

/**
 * Plan d'import construit a partir du fichier xlsx parse + de l'etat actuel de la DB.
 * Pour chaque recette du fichier, on classe en creation / mise a jour / inchangee.
 */
interface RecipePlanRow {
  sourceRow: number;
  name: string;
  isBase: boolean;
  productId: string | null;        // null si recette de base ou produit non trouve
  productName: string | null;
  yieldQuantity: number;
  yieldUnit: string;
  marginMultiplier: number | null;
  instructions: string | null;
  existingId: string | null;
  // ingredientId = null + ingredientName renseigne => sera resolu au commit
  // apres auto-creation des ingredients manquants.
  ingredients: { ingredientId: string | null; ingredientName: string; quantity: number; unit: string | null }[];
  subRecipes: { subRecipeId: string; quantity: number }[];
  packaging: { packagingId: string; quantity: number; unit: string | null }[];
  changes?: string[];               // pour preview : liste champs modifies
}

interface MissingIngredient {
  name: string;
  unit: string;        // unite du fichier (premiere occurrence)
  firstRow: number;    // ligne du fichier ou il apparait pour la 1ere fois
}

interface RecipePlan {
  toCreate: RecipePlanRow[];
  toUpdate: RecipePlanRow[];
  unchanged: RecipePlanRow[];
  lookupErrors: { sheet: string; sourceRow: number; message: string }[];
  // Ingredients absents de l'economat — seront crees automatiquement au commit
  // (unit du fichier, cout=0, categorie='autre'). L'admin met a jour les couts apres.
  ingredientsToCreate: MissingIngredient[];
}

/**
 * Construit le plan : resolution des references (produits, ingredients,
 * sous-recettes, emballages) + diff vs etat actuel.
 *
 * Strategie de matching :
 *   - Recettes : par nom case-insensitive (toute ambiguite = on prend la 1ere et warn)
 *   - Produits, ingredients, emballages : idem
 *   - Les recettes de base utilisees comme sous-recettes peuvent provenir
 *     soit de la DB existante soit du meme fichier (creation simultanee).
 *     Pour gerer ce cas, on resout en 2 passes lors du commit (pas du plan).
 */
async function buildPlan(parsed: ParsedRecipesWorkbook): Promise<RecipePlan> {
  const lookupErrors: { sheet: string; sourceRow: number; message: string }[] = [];
  // Cle UPPERCASE -> { name original, unit du fichier, ligne }. Dedupe par cle.
  const missingIngredientsMap = new Map<string, MissingIngredient>();

  // Lookup tables — recuperees une seule fois en debut de plan
  const recipesByName = new Map<string, {
    id: string; name: string; is_base: boolean; product_id: string | null;
    yield_quantity: number | string; yield_unit: string;
    margin_multiplier: number | string | null; instructions: string | null;
  }>();
  const recipesRes = await db.query(
    `SELECT id, name, is_base, product_id, yield_quantity, yield_unit, margin_multiplier, instructions FROM recipes`
  );
  for (const r of recipesRes.rows) {
    recipesByName.set(String(r.name).trim().toUpperCase(), r);
  }

  const productsByName = new Map<string, string>();    // name -> id
  const productsRes = await db.query(`SELECT id, name FROM products`);
  for (const p of productsRes.rows) {
    productsByName.set(String(p.name).trim().toUpperCase(), p.id);
  }

  const ingredientsByName = new Map<string, string>();
  const ingredientsRes = await db.query(`SELECT id, name FROM ingredients`);
  for (const i of ingredientsRes.rows) {
    ingredientsByName.set(String(i.name).trim().toUpperCase(), i.id);
  }

  const packagingByName = new Map<string, string>();
  const packagingRes = await db.query(`SELECT id, name FROM packaging_items`);
  for (const p of packagingRes.rows) {
    packagingByName.set(String(p.name).trim().toUpperCase(), p.id);
  }

  // Index des lignes par recette (pour assembler ingredients/sous-recettes/emballages)
  const ingByRecipe = new Map<string, typeof parsed.ingredients>();
  for (const ing of parsed.ingredients) {
    const key = ing.recipeName.toUpperCase();
    if (!ingByRecipe.has(key)) ingByRecipe.set(key, []);
    ingByRecipe.get(key)!.push(ing);
  }
  const subByRecipe = new Map<string, typeof parsed.subRecipes>();
  for (const sr of parsed.subRecipes) {
    const key = sr.recipeName.toUpperCase();
    if (!subByRecipe.has(key)) subByRecipe.set(key, []);
    subByRecipe.get(key)!.push(sr);
  }
  const pkgByRecipe = new Map<string, typeof parsed.packaging>();
  for (const pk of parsed.packaging) {
    const key = pk.recipeName.toUpperCase();
    if (!pkgByRecipe.has(key)) pkgByRecipe.set(key, []);
    pkgByRecipe.get(key)!.push(pk);
  }

  // Noms des recettes du fichier (pour la resolution differee des sous-recettes)
  const fileRecipeNames = new Set(parsed.recipes.map(r => r.name.toUpperCase()));

  const toCreate: RecipePlanRow[] = [];
  const toUpdate: RecipePlanRow[] = [];
  const unchanged: RecipePlanRow[] = [];

  for (const rec of parsed.recipes) {
    const nameKey = rec.name.toUpperCase();
    const existing = recipesByName.get(nameKey);

    // Lookup produit (si recette produit fini)
    let productId: string | null = null;
    if (!rec.isBase && rec.productName) {
      const pid = productsByName.get(rec.productName.toUpperCase());
      if (!pid) {
        lookupErrors.push({
          sheet: 'Recettes',
          sourceRow: rec.sourceRow,
          message: `Produit "${rec.productName}" introuvable. Creer le produit d'abord ou laisser la colonne vide.`,
        });
        continue;
      }
      productId = pid;
    }

    // Lookup ingredients — auto-creation differee si introuvable
    const ingredients: { ingredientId: string | null; ingredientName: string; quantity: number; unit: string | null }[] = [];
    const ingredientRows = ingByRecipe.get(nameKey) || [];
    for (const ing of ingredientRows) {
      const key = ing.ingredientName.toUpperCase();
      const ingId = ingredientsByName.get(key);
      if (!ingId) {
        // Marque pour auto-creation. Le commit creera l'ingredient avec
        // unit=fichier, cout=0, categorie='autre' avant de monter la recette.
        if (!missingIngredientsMap.has(key)) {
          missingIngredientsMap.set(key, {
            name: ing.ingredientName,
            unit: ing.unit,
            firstRow: ing.sourceRow,
          });
        }
        ingredients.push({
          ingredientId: null,
          ingredientName: ing.ingredientName,
          quantity: ing.quantity,
          unit: ing.unit,
        });
        continue;
      }
      ingredients.push({
        ingredientId: ingId,
        ingredientName: ing.ingredientName,
        quantity: ing.quantity,
        unit: ing.unit,
      });
    }

    // Lookup sous-recettes (peuvent venir du fichier OU de la DB)
    // On stocke null pour les sous-recettes a creer dans le meme batch — sera
    // resolu en seconde passe lors du commit.
    const subRecipes: { subRecipeId: string; quantity: number }[] = [];
    const subRecipeNamesToResolve: { name: string; quantity: number; sourceRow: number }[] = [];
    const subRows = subByRecipe.get(nameKey) || [];
    let subError = false;
    for (const sr of subRows) {
      const subKey = sr.subRecipeName.toUpperCase();
      const existingSub = recipesByName.get(subKey);
      if (existingSub) {
        if (!existingSub.is_base) {
          lookupErrors.push({
            sheet: 'Sous-recettes',
            sourceRow: sr.sourceRow,
            message: `"${sr.subRecipeName}" n'est pas une recette de base (champ Base? = non). Seules les recettes marquees comme base peuvent etre utilisees comme sous-recettes.`,
          });
          subError = true;
          continue;
        }
        subRecipes.push({ subRecipeId: existingSub.id, quantity: sr.quantity });
      } else if (fileRecipeNames.has(subKey)) {
        // Sera creee dans ce meme batch — verifier que c'est bien une base
        const fileMatch = parsed.recipes.find(r => r.name.toUpperCase() === subKey);
        if (fileMatch && !fileMatch.isBase) {
          lookupErrors.push({
            sheet: 'Sous-recettes',
            sourceRow: sr.sourceRow,
            message: `"${sr.subRecipeName}" est dans le fichier mais marquee Base? = non. Une sous-recette doit etre une recette de base.`,
          });
          subError = true;
          continue;
        }
        subRecipeNamesToResolve.push({ name: sr.subRecipeName, quantity: sr.quantity, sourceRow: sr.sourceRow });
      } else {
        lookupErrors.push({
          sheet: 'Sous-recettes',
          sourceRow: sr.sourceRow,
          message: `Sous-recette "${sr.subRecipeName}" introuvable (ni en DB, ni dans le fichier).`,
        });
        subError = true;
      }
    }
    if (subError) continue;

    // Lookup emballages
    const packaging: { packagingId: string; quantity: number; unit: string | null }[] = [];
    const pkgRows = pkgByRecipe.get(nameKey) || [];
    let pkgError = false;
    for (const pk of pkgRows) {
      const pkgId = packagingByName.get(pk.packagingName.toUpperCase());
      if (!pkgId) {
        lookupErrors.push({
          sheet: 'Emballages',
          sourceRow: pk.sourceRow,
          message: `Emballage "${pk.packagingName}" introuvable. Creer l'emballage d'abord.`,
        });
        pkgError = true;
        continue;
      }
      packaging.push({ packagingId: pkgId, quantity: pk.quantity, unit: pk.unit });
    }
    if (pkgError) continue;

    const planRow: RecipePlanRow = {
      sourceRow: rec.sourceRow,
      name: rec.name,
      isBase: rec.isBase,
      productId,
      productName: rec.productName,
      yieldQuantity: rec.yieldQuantity,
      yieldUnit: rec.yieldUnit,
      marginMultiplier: rec.marginMultiplier,
      instructions: rec.instructions,
      existingId: existing?.id || null,
      ingredients,
      subRecipes,
      packaging,
    };

    // Stocke les references differees sur le plan pour resolution au commit
    (planRow as RecipePlanRow & { _pendingSubRecipes?: typeof subRecipeNamesToResolve })._pendingSubRecipes =
      subRecipeNamesToResolve.length > 0 ? subRecipeNamesToResolve : undefined;

    if (!existing) {
      toCreate.push(planRow);
    } else {
      const changes: string[] = [];
      if (existing.is_base !== rec.isBase) changes.push('type (base/produit)');
      if ((existing.product_id || null) !== productId) changes.push('produit lie');
      if (Math.abs(parseFloat(String(existing.yield_quantity || '0')) - rec.yieldQuantity) > 0.0001) changes.push('rendement');
      if (existing.yield_unit !== rec.yieldUnit) changes.push('unite');
      if (rec.marginMultiplier !== null) {
        const existingMargin = parseFloat(String(existing.margin_multiplier || '0'));
        if (Math.abs(existingMargin - rec.marginMultiplier) > 0.0001) changes.push('marge');
      }
      if ((existing.instructions || '') !== (rec.instructions || '')) changes.push('instructions');
      // On marque toujours les compositions comme potentiellement modifiees — coute
      // peu et c'est presque toujours vrai si l'utilisateur a fait l'effort de
      // re-importer. Detail des ingredients ne change rien au comportement.
      if (ingredients.length > 0 || subRecipes.length > 0 || packaging.length > 0 ||
          subRecipeNamesToResolve.length > 0) {
        changes.push('composition');
      }

      if (changes.length === 0) {
        unchanged.push({ ...planRow, changes: [] });
      } else {
        toUpdate.push({ ...planRow, changes });
      }
    }
  }

  return {
    toCreate, toUpdate, unchanged, lookupErrors,
    ingredientsToCreate: Array.from(missingIngredientsMap.values()),
  };
}

/**
 * Construit la payload d'export a partir d'une selection de recettes.
 */
async function buildExportPayload(filter: 'all' | 'base' | 'product'): Promise<RecipeExportPayload> {
  let where = '';
  if (filter === 'base') where = 'WHERE r.is_base = true';
  else if (filter === 'product') where = 'WHERE r.is_base = false';

  const recipesRes = await db.query(
    `SELECT r.id, r.name, r.is_base, r.product_id, r.yield_quantity, r.yield_unit,
            r.margin_multiplier, r.instructions,
            p.name AS product_name,
            vtc.total_cost
     FROM recipes r
     LEFT JOIN products p ON p.id = r.product_id
     LEFT JOIN v_recipe_total_cost vtc ON vtc.id = r.id
     ${where}
     ORDER BY r.is_base DESC, r.name`
  );

  if (recipesRes.rows.length === 0) {
    return { recipes: [], ingredients: [], subRecipes: [], packaging: [] };
  }

  const recipeIds = recipesRes.rows.map(r => r.id as string);
  const recipeNameById = new Map<string, string>(
    recipesRes.rows.map(r => [r.id as string, r.name as string])
  );

  // Ingredients
  const ingRes = await db.query(
    `SELECT ri.recipe_id, ri.quantity, COALESCE(ri.unit, ing.unit) AS unit, ing.name AS ingredient_name
     FROM recipe_ingredients ri
     JOIN ingredients ing ON ing.id = ri.ingredient_id
     WHERE ri.recipe_id = ANY($1::uuid[])
     ORDER BY ing.name`,
    [recipeIds]
  );

  // Sous-recettes
  const subRes = await db.query(
    `SELECT rsr.recipe_id, rsr.quantity, sr.name AS sub_recipe_name
     FROM recipe_sub_recipes rsr
     JOIN recipes sr ON sr.id = rsr.sub_recipe_id
     WHERE rsr.recipe_id = ANY($1::uuid[])
     ORDER BY sr.name`,
    [recipeIds]
  );

  // Emballages
  const pkgRes = await db.query(
    `SELECT rp.recipe_id, rp.quantity, rp.unit, pi.name AS packaging_name
     FROM recipe_packaging rp
     JOIN packaging_items pi ON pi.id = rp.packaging_id
     WHERE rp.recipe_id = ANY($1::uuid[])
     ORDER BY pi.name`,
    [recipeIds]
  );

  const recipes = recipesRes.rows.map(r => {
    const totalCost = parseFloat(String(r.total_cost || '0')) || 0;
    const yieldQty = parseFloat(String(r.yield_quantity || '1')) || 1;
    return {
      name: r.name as string,
      isBase: r.is_base as boolean,
      productName: r.product_name as string | null,
      yieldQuantity: yieldQty,
      yieldUnit: r.yield_unit as string,
      marginMultiplier: r.margin_multiplier !== null ? parseFloat(String(r.margin_multiplier)) : null,
      instructions: r.instructions as string | null,
      totalCost,
      costPerUnit: yieldQty > 0 ? totalCost / yieldQty : 0,
    };
  });

  const ingredients = ingRes.rows.map(r => ({
    recipeName: recipeNameById.get(r.recipe_id as string) || '',
    ingredientName: r.ingredient_name as string,
    quantity: parseFloat(String(r.quantity || '0')) || 0,
    unit: r.unit as string,
  }));

  const subRecipes = subRes.rows.map(r => ({
    recipeName: recipeNameById.get(r.recipe_id as string) || '',
    subRecipeName: r.sub_recipe_name as string,
    quantity: parseFloat(String(r.quantity || '0')) || 0,
  }));

  const packaging = pkgRes.rows.map(r => ({
    recipeName: recipeNameById.get(r.recipe_id as string) || '',
    packagingName: r.packaging_name as string,
    quantity: parseFloat(String(r.quantity || '0')) || 0,
    unit: r.unit as string | null,
  }));

  return { recipes, ingredients, subRecipes, packaging };
}

export const recipeImportController = {
  /**
   * GET /api/v1/recipes/export?scope=all|base|product
   * Genere un xlsx multi-feuilles avec les recettes (et leurs compositions).
   */
  async export(req: AuthRequest, res: Response) {
    const scopeRaw = String(req.query.scope || 'all').toLowerCase();
    const scope: 'all' | 'base' | 'product' =
      scopeRaw === 'base' ? 'base' : scopeRaw === 'product' ? 'product' : 'all';

    const payload = await buildExportPayload(scope);
    const buffer = generateRecipeWorkbook(payload, { includeCost: true });

    const stamp = new Date().toISOString().slice(0, 10);
    const suffix = scope === 'base' ? 'recettes-base' : scope === 'product' ? 'recettes-produits' : 'recettes';
    const filename = `${suffix}-${stamp}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  },

  /**
   * POST /api/v1/recipes/import/preview
   * Analyse le xlsx, retourne plan (create/update/unchanged) + erreurs.
   */
  async preview(req: AuthRequest, res: Response) {
    if (!req.file) {
      res.status(400).json({ success: false, error: { message: 'Aucun fichier envoye' } });
      return;
    }
    try {
      const parsed = parseRecipeWorkbook(req.file.buffer);
      const plan = await buildPlan(parsed);

      // Combine erreurs de parsing + erreurs de lookup
      const allErrors = [
        ...parsed.errors,
        ...plan.lookupErrors,
      ];

      res.json({
        success: true,
        data: {
          summary: {
            totalRows: parsed.recipes.length,
            toCreate: plan.toCreate.length,
            toUpdate: plan.toUpdate.length,
            unchanged: plan.unchanged.length,
            errors: allErrors.length,
            ingredientsToCreate: plan.ingredientsToCreate.length,
          },
          toCreate: plan.toCreate.map(r => ({
            sourceRow: r.sourceRow, name: r.name, isBase: r.isBase,
            productName: r.productName, yieldQuantity: r.yieldQuantity, yieldUnit: r.yieldUnit,
            marginMultiplier: r.marginMultiplier,
            ingredientsCount: r.ingredients.length,
            subRecipesCount: r.subRecipes.length + (((r as any)._pendingSubRecipes as unknown[])?.length || 0),
            packagingCount: r.packaging.length,
          })),
          toUpdate: plan.toUpdate.map(r => ({
            sourceRow: r.sourceRow, name: r.name, isBase: r.isBase,
            productName: r.productName, yieldQuantity: r.yieldQuantity, yieldUnit: r.yieldUnit,
            marginMultiplier: r.marginMultiplier,
            ingredientsCount: r.ingredients.length,
            subRecipesCount: r.subRecipes.length + (((r as any)._pendingSubRecipes as unknown[])?.length || 0),
            packagingCount: r.packaging.length,
            changes: r.changes || [],
          })),
          ingredientsToCreate: plan.ingredientsToCreate,
          errors: allErrors,
          warnings: parsed.warnings,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur de parsing';
      res.status(400).json({ success: false, error: { message: msg } });
    }
  },

  /**
   * POST /api/v1/recipes/import/commit
   * Applique l'import en transaction — utilise recipeRepository pour beneficier
   * de la detection de cycle, du versionning et de la cascade prix produits.
   *
   * Strategie pour les dependances entre recettes du meme fichier :
   *   1. Trier les a-creer : recettes de base d'abord (sans dependance), puis
   *      les recettes qui referencent uniquement des bases existantes en DB.
   *   2. Apres chaque creation, mettre a jour la map (name -> id) pour resoudre
   *      les sous-recettes en attente des etapes suivantes.
   *   3. Pour les updates, idem mais on resout les sous-recettes pendantes
   *      en lisant l'id qui vient d'etre cree.
   */
  async commit(req: AuthRequest, res: Response) {
    if (!req.file) {
      res.status(400).json({ success: false, error: { message: 'Aucun fichier envoye' } });
      return;
    }
    let parsed: ParsedRecipesWorkbook;
    try {
      parsed = parseRecipeWorkbook(req.file.buffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur de parsing';
      res.status(400).json({ success: false, error: { message: msg } });
      return;
    }

    const plan = await buildPlan(parsed);
    const totalErrors = parsed.errors.length + plan.lookupErrors.length;
    if (totalErrors > 0) {
      res.status(400).json({
        success: false,
        error: { message: `${totalErrors} erreur(s) de validation — corrigez le fichier avant import` },
      });
      return;
    }

    // Map nom -> id (peuplee au fur et a mesure des creations)
    const nameToId = new Map<string, string>();
    const existingByName = await db.query(`SELECT id, name FROM recipes`);
    for (const r of existingByName.rows) {
      nameToId.set(String(r.name).trim().toUpperCase(), r.id);
    }

    let created = 0;
    let updated = 0;
    let ingredientsCreated = 0;
    const errors: { row: number; sheet?: string; message: string }[] = [];

    // === Auto-creation des ingredients manquants ===
    // Avant de monter les recettes, on cree les ingredients absents de l'economat
    // avec : unit = celle du fichier, cout = 0, categorie = 'autre'.
    // L'admin completera les couts apres via l'economat (cela recalculera les
    // recettes via la cascade existante sur unit_cost).
    const ingredientNameToId = new Map<string, string>();
    const existingIngredients = await db.query(`SELECT id, name FROM ingredients`);
    for (const r of existingIngredients.rows) {
      ingredientNameToId.set(String(r.name).trim().toUpperCase(), r.id);
    }

    if (plan.ingredientsToCreate.length > 0) {
      const storeId = req.user?.storeId || null;
      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        for (const missing of plan.ingredientsToCreate) {
          const ins = await client.query(
            `INSERT INTO ingredients (name, unit, unit_cost, supplier, allergens, category)
             VALUES ($1, $2, 0, NULL, '{}', 'autre') RETURNING id`,
            [missing.name, missing.unit]
          );
          const newId = ins.rows[0].id as string;
          await client.query(
            `INSERT INTO inventory (ingredient_id, store_id) VALUES ($1, $2)`,
            [newId, storeId]
          );
          ingredientNameToId.set(missing.name.toUpperCase(), newId);
          ingredientsCreated++;
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        const msg = err instanceof Error ? err.message : 'Erreur creation ingredients';
        res.status(500).json({ success: false, error: { message: `Auto-creation ingredients : ${msg}` } });
        return;
      } finally {
        client.release();
      }
    }

    /** Resout les ingredients en attente (ingredientId=null) depuis ingredientNameToId. */
    function resolveIngredients(planRow: RecipePlanRow): boolean {
      for (const ing of planRow.ingredients) {
        if (ing.ingredientId) continue;
        const id = ingredientNameToId.get(ing.ingredientName.toUpperCase());
        if (!id) {
          errors.push({
            row: planRow.sourceRow,
            sheet: 'Ingredients',
            message: `Ingredient "${ing.ingredientName}" introuvable apres auto-creation — bug interne`,
          });
          return false;
        }
        ing.ingredientId = id;
      }
      return true;
    }

    // === Tri topologique simplifie ===
    // Les recettes a creer qui sont REFERENCEES par d'autres recettes du batch
    // doivent etre creees en premier. On trie : bases d'abord, produits ensuite.
    // Pour les bases, on fait plusieurs passes (max 3) tant que des sous-recettes
    // restent non resolues.
    const baseToCreate = plan.toCreate.filter(r => r.isBase);
    const productToCreate = plan.toCreate.filter(r => !r.isBase);

    /** Resout les sous-recettes en attente depuis nameToId. Retourne true si tout OK. */
    function resolvePendingSubs(planRow: RecipePlanRow): boolean {
      const pending = (planRow as any)._pendingSubRecipes as
        { name: string; quantity: number; sourceRow: number }[] | undefined;
      if (!pending || pending.length === 0) return true;
      for (const p of pending) {
        const id = nameToId.get(p.name.toUpperCase());
        if (!id) return false;
        planRow.subRecipes.push({ subRecipeId: id, quantity: p.quantity });
      }
      (planRow as any)._pendingSubRecipes = undefined;
      return true;
    }

    async function createOne(planRow: RecipePlanRow) {
      if (!resolveIngredients(planRow)) return false;
      try {
        const result = await recipeRepository.create({
          productId: planRow.productId || undefined,
          name: planRow.name,
          instructions: planRow.instructions || undefined,
          yieldQuantity: planRow.yieldQuantity,
          yieldUnit: planRow.yieldUnit,
          isBase: planRow.isBase,
          marginMultiplier: planRow.marginMultiplier || undefined,
          ingredients: planRow.ingredients.map(i => ({
            ingredientId: i.ingredientId as string,
            quantity: i.quantity,
            unit: i.unit,
          })),
          subRecipes: planRow.subRecipes,
          packaging: planRow.packaging,
        });
        nameToId.set(planRow.name.toUpperCase(), result.id);
        created++;
        return true;
      } catch (e) {
        errors.push({
          row: planRow.sourceRow,
          sheet: 'Recettes',
          message: e instanceof Error ? e.message : 'Erreur de creation',
        });
        return false;
      }
    }

    // === 1. Creation des bases (avec passes multiples si dependances entre elles) ===
    let pendingBases = [...baseToCreate];
    for (let pass = 0; pass < 4 && pendingBases.length > 0; pass++) {
      const stillPending: RecipePlanRow[] = [];
      for (const row of pendingBases) {
        if (!resolvePendingSubs(row)) {
          stillPending.push(row);
          continue;
        }
        await createOne(row);
      }
      pendingBases = stillPending;
    }
    if (pendingBases.length > 0) {
      for (const row of pendingBases) {
        errors.push({
          row: row.sourceRow,
          sheet: 'Sous-recettes',
          message: `Impossible de resoudre les sous-recettes de "${row.name}" — cycle ou reference invalide`,
        });
      }
    }

    // === 2. Creation des produits (apres les bases) ===
    for (const row of productToCreate) {
      if (!resolvePendingSubs(row)) {
        errors.push({
          row: row.sourceRow,
          sheet: 'Sous-recettes',
          message: `Sous-recettes non resolues pour "${row.name}"`,
        });
        continue;
      }
      await createOne(row);
    }

    // === 3. Mises a jour ===
    const allUpdates = [...plan.toUpdate];
    let pendingUpdates = [...allUpdates];
    for (let pass = 0; pass < 4 && pendingUpdates.length > 0; pass++) {
      const stillPending: RecipePlanRow[] = [];
      for (const row of pendingUpdates) {
        if (!resolvePendingSubs(row)) {
          stillPending.push(row);
          continue;
        }
        if (!row.existingId) {
          errors.push({ row: row.sourceRow, sheet: 'Recettes', message: 'Id manquant pour update' });
          continue;
        }
        if (!resolveIngredients(row)) continue;
        try {
          await recipeRepository.update(row.existingId, {
            name: row.name,
            instructions: row.instructions || undefined,
            yieldQuantity: row.yieldQuantity,
            yieldUnit: row.yieldUnit,
            isBase: row.isBase,
            marginMultiplier: row.marginMultiplier || undefined,
            ingredients: row.ingredients.map(i => ({
              ingredientId: i.ingredientId as string,
              quantity: i.quantity,
              unit: i.unit,
            })),
            subRecipes: row.subRecipes,
            packaging: row.packaging,
            changedBy: req.user?.userId,
            changeNote: `Import xlsx (admin)`,
          });
          updated++;
        } catch (e) {
          errors.push({
            row: row.sourceRow,
            sheet: 'Recettes',
            message: e instanceof Error ? e.message : 'Erreur de mise a jour',
          });
        }
      }
      pendingUpdates = stillPending;
    }
    if (pendingUpdates.length > 0) {
      for (const row of pendingUpdates) {
        errors.push({
          row: row.sourceRow,
          sheet: 'Sous-recettes',
          message: `Impossible de resoudre les sous-recettes de "${row.name}"`,
        });
      }
    }

    res.json({
      success: true,
      data: {
        created,
        updated,
        unchanged: plan.unchanged.length,
        ingredientsCreated,
        warnings: parsed.warnings,
        errors,
      },
    });
  },

  /**
   * GET /api/v1/recipes/import/template
   * Renvoie un xlsx vide (en-tetes + 1 ligne d'exemple) pour aider l'utilisateur.
   */
  async template(_req: AuthRequest, res: Response) {
    const payload: RecipeExportPayload = {
      recipes: [
        {
          name: 'Croissant au beurre',
          isBase: false,
          productName: 'Croissant',
          yieldQuantity: 10,
          yieldUnit: 'unit',
          marginMultiplier: 3,
          instructions: '1. Petrir la pate.\n2. Laisser pousser 1h.\n3. Cuire 18 min a 200C.',
        },
        {
          name: 'Pate croissant',
          isBase: true,
          productName: null,
          yieldQuantity: 1,
          yieldUnit: 'kg',
          marginMultiplier: null,
          instructions: 'Petrir farine + beurre + eau + levure. Tour double + tour simple.',
        },
      ],
      ingredients: [
        { recipeName: 'Croissant au beurre', ingredientName: 'Sucre glace', quantity: 20, unit: 'g' },
        { recipeName: 'Pate croissant', ingredientName: 'Farine T55', quantity: 500, unit: 'g' },
        { recipeName: 'Pate croissant', ingredientName: 'Beurre', quantity: 250, unit: 'g' },
      ],
      subRecipes: [
        { recipeName: 'Croissant au beurre', subRecipeName: 'Pate croissant', quantity: 0.5 },
      ],
      packaging: [
        { recipeName: 'Croissant au beurre', packagingName: 'Sachet kraft 10x15', quantity: 10, unit: 'unit' },
      ],
    };
    const buffer = generateRecipeWorkbook(payload, { includeCost: false });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="recettes-modele-import.xlsx"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  },
};
