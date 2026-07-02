import { convertQuantity } from '../utils/units.js';

// Source unique de la nomenclature pour le calcul des BESOINS de production
// (confirmation de plan / BSI, deduction stock, detection semi-finis, analyse).
//
// Probleme resolu : les recettes en mode 'compose' stockent leur composition dans
// recipe_components / recipe_format_components, et la sauvegarde de la composition
// du format par defaut VIDE recipe_ingredients + recipe_sub_recipes (voir
// recipe-component.repository.replaceForFormat). Tous les calculs de besoins qui
// ne lisent que les tables legacy voient donc une recette composee comme VIDE :
// plan confirme sans besoins, sans BSI, sans plans semi-finis.
//
// Semantique alignee sur v_recipe_total_cost (migration 205) :
// - composant ingredient : quantite * fn_unit_conv(unite, ing.unit)  → unite de base
// - composant recette    : quantite * fn_unit_conv(unite, br.yield_unit) → net ;
//                          brut = net / (1 - perte_standard_pct/100)
// - une compo decrit 1 piece (compo_par_piece) ou 1 fournee de `rendement` pieces,
//   rendement = pieces_par_fournee ?? nb_par_defaut du format ?? yield_quantity.

type QueryClient = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export interface CompositionIngredient {
  ingredientId: string;
  name: string;
  /** Unite de base de l'ingredient (celle du stock/BSI/FEFO). */
  unit: string;
  /** Quantite par lot de composition, deja convertie dans l'unite de base de l'ingredient. */
  qtyPerBatch: number;
  /** Quantite telle que saisie dans la recette (pour l'affichage : 420 g reste 420 g). */
  qtyEntered: number;
  /** Unite telle que saisie dans la recette (kg, g, ml, l...). */
  unitEntered: string;
  /** True si une conversion poids<->volume etait requise sans densite renseignee
   *  (ex: recette en kg, lait stocke en l, densite_kg_l NULL) : qtyPerBatch est
   *  alors la valeur brute, l'appelant doit remonter un warning. */
  conversionUncertain: boolean;
}

export interface CompositionSubRecipe {
  subRecipeId: string;
  name: string;
  isBase: boolean;
  yieldUnit: string;
  yieldQuantity: number;
  /** Quantite utilisable par lot de composition, en unite de rendement de la sous-recette. */
  netQtyPerBatch: number;
  /** Quantite a produire (brut de perte_standard_pct) pour obtenir netQtyPerBatch. */
  grossQtyPerBatch: number;
}

export interface RecipeComposition {
  recipeId: string;
  recipeName: string;
  mode: 'compose' | 'legacy';
  /** Table effectivement lue (une recette compose sans composants retombe sur le legacy). */
  source: 'recipe_format_components' | 'recipe_components' | 'legacy';
  /** Unites de produit decrites par un lot de composition (diviseur des besoins). */
  batchDivisor: number;
  ingredients: CompositionIngredient[];
  subRecipes: CompositionSubRecipe[];
  isEmpty: boolean;
}

const MAX_DEPTH = 12; // meme plafond que v_recipe_total_cost (mig 204)

export async function getCompositionForNeeds(
  client: QueryClient,
  recipeId: string,
  formatId?: string | null
): Promise<RecipeComposition | null> {
  const recResult = await client.query(
    `SELECT r.id, r.name, r.yield_quantity, r.yield_unit, r.mode_cout,
            r.compo_par_piece, r.pieces_par_fournee,
            (SELECT rf.nb_par_defaut FROM recipe_formats rf
              WHERE rf.recipe_id = r.id AND rf.is_active = true
              ORDER BY rf.is_default DESC, rf.ordre LIMIT 1) AS default_format_nb
     FROM recipes r WHERE r.id = $1`,
    [recipeId]
  );
  if (!recResult.rows[0]) return null;
  const rec = recResult.rows[0];
  const yieldQty = parseFloat(rec.yield_quantity) > 0 ? parseFloat(rec.yield_quantity) : 1;

  if (rec.mode_cout === 'compose') {
    // 1) Composition du format demande si elle existe, sinon celle de la recette
    //    (recipe_components est le miroir du format par defaut).
    let rows: any[] = [];
    let source: RecipeComposition['source'] = 'recipe_components';
    let formatNb: number | null = null;

    if (formatId) {
      // Le format doit appartenir a la recette : un format_id etranger sur un
      // item de plan ne doit pas injecter la composition d'une autre recette.
      const fmt = await client.query(
        `SELECT nb_par_defaut FROM recipe_formats WHERE id = $1 AND recipe_id = $2`,
        [formatId, recipeId]
      );
      if (fmt.rows[0]) {
        const fmtRows = await client.query(componentQuery('recipe_format_components', 'format_id'), [formatId]);
        if (fmtRows.rows.length > 0) {
          rows = fmtRows.rows;
          source = 'recipe_format_components';
          formatNb = parseInt(fmt.rows[0].nb_par_defaut);
        }
      }
    }
    if (rows.length === 0) {
      rows = (await client.query(componentQuery('recipe_components', 'recipe_id'), [recipeId])).rows;
      source = 'recipe_components';
    }

    if (rows.length > 0) {
      // Diviseur : la compo decrit 1 piece, ou 1 fournee de `rendement` pieces.
      let batchDivisor = 1;
      if (rec.compo_par_piece !== true) {
        const rendement = (formatNb && formatNb > 0 ? formatNb : null)
          ?? (rec.pieces_par_fournee && parseInt(rec.pieces_par_fournee) > 0 ? parseInt(rec.pieces_par_fournee) : null)
          ?? (rec.default_format_nb && parseInt(rec.default_format_nb) > 0 ? parseInt(rec.default_format_nb) : null)
          ?? yieldQty;
        batchDivisor = rendement > 0 ? rendement : 1;
      }
      return {
        recipeId, recipeName: rec.name, mode: 'compose', source, batchDivisor,
        ingredients: rows.filter(r => r.source_ingredient_id).map(r => ({
          ingredientId: r.source_ingredient_id,
          name: r.ingredient_name,
          unit: r.ingredient_unit,
          qtyPerBatch: parseFloat(r.qty_ing_base),
          qtyEntered: parseFloat(r.qty_entered),
          unitEntered: r.unit_entered,
          conversionUncertain: r.conv_incertaine === true,
        })),
        subRecipes: rows.filter(r => r.source_recipe_id).map(r => ({
          subRecipeId: r.source_recipe_id,
          name: r.sub_name,
          isBase: r.sub_is_base === true,
          yieldUnit: r.sub_yield_unit || 'unit',
          yieldQuantity: parseFloat(r.sub_yield_quantity) > 0 ? parseFloat(r.sub_yield_quantity) : 1,
          netQtyPerBatch: parseFloat(r.qty_sub_net),
          grossQtyPerBatch: parseFloat(r.qty_sub_gross),
        })),
        isEmpty: false,
      };
    }
    // Compose sans composants (mode bascule mais compo jamais saisie) :
    // on retombe sur le legacy s'il existe encore — meme logique que findChildren.
  }

  // Mode legacy (ratio_poids) ou fallback compose-vide.
  const ings = await client.query(
    `SELECT ri.ingredient_id, ri.quantity, ing.name AS ingredient_name,
            COALESCE(NULLIF(ri.unit, ''), ing.unit) AS recipe_unit,
            ing.unit AS base_unit, ing.densite_kg_l
       FROM recipe_ingredients ri
       JOIN ingredients ing ON ing.id = ri.ingredient_id
      WHERE ri.recipe_id = $1`,
    [recipeId]
  );
  const subs = await client.query(
    `SELECT rsr.sub_recipe_id, rsr.quantity, r.name, r.is_base, r.yield_quantity, r.yield_unit
       FROM recipe_sub_recipes rsr
       JOIN recipes r ON r.id = rsr.sub_recipe_id
      WHERE rsr.recipe_id = $1`,
    [recipeId]
  );
  return {
    recipeId, recipeName: rec.name, mode: 'legacy', source: 'legacy', batchDivisor: yieldQty,
    ingredients: ings.rows.map((ri: any) => {
      const densite = ri.densite_kg_l != null ? parseFloat(ri.densite_kg_l) : null;
      const conv = convertQuantity(parseFloat(ri.quantity), ri.recipe_unit, ri.base_unit, densite);
      return {
        ingredientId: ri.ingredient_id,
        name: ri.ingredient_name,
        unit: ri.base_unit,
        qtyPerBatch: conv.value,
        qtyEntered: parseFloat(ri.quantity),
        unitEntered: ri.recipe_unit,
        conversionUncertain: conv.uncertain,
      };
    }),
    subRecipes: subs.rows.map((sub: any) => ({
      subRecipeId: sub.sub_recipe_id,
      name: sub.name,
      isBase: sub.is_base === true,
      yieldUnit: sub.yield_unit || 'unit',
      yieldQuantity: parseFloat(sub.yield_quantity) > 0 ? parseFloat(sub.yield_quantity) : 1,
      // Le legacy ne modelise pas la perte : net = brut.
      netQtyPerBatch: parseFloat(sub.quantity),
      grossQtyPerBatch: parseFloat(sub.quantity),
    })),
    isEmpty: ings.rows.length === 0 && subs.rows.length === 0,
  };
}

function componentQuery(table: string, keyColumn: string): string {
  return `
    SELECT c.source_recipe_id, c.source_ingredient_id,
           ing.name AS ingredient_name, ing.unit AS ingredient_unit,
           c.quantite AS qty_entered, c.unite AS unit_entered,
           c.quantite * fn_unit_conv(c.unite, ing.unit::text, ing.densite_kg_l) AS qty_ing_base,
           (((lower(c.unite) IN ('mg','g','kg') AND lower(ing.unit::text) IN ('ml','cl','dl','l'))
              OR (lower(c.unite) IN ('ml','cl','dl','l') AND lower(ing.unit::text) IN ('mg','g','kg')))
             AND ing.densite_kg_l IS NULL) AS conv_incertaine,
           br.name AS sub_name, br.is_base AS sub_is_base,
           br.yield_unit AS sub_yield_unit, br.yield_quantity AS sub_yield_quantity,
           c.quantite * fn_unit_conv(c.unite, br.yield_unit) AS qty_sub_net,
           COALESCE(
             c.quantite * fn_unit_conv(c.unite, br.yield_unit)
               / NULLIF(1 - COALESCE(br.perte_standard_pct, 0) / 100, 0),
             c.quantite * fn_unit_conv(c.unite, br.yield_unit)
           ) AS qty_sub_gross
      FROM ${table} c
      LEFT JOIN ingredients ing ON ing.id = c.source_ingredient_id
      LEFT JOIN recipes br ON br.id = c.source_recipe_id
     WHERE c.${keyColumn} = $1`;
}

export interface CollectNeedsOptions {
  /** Format du plan item (compose uniquement, applique au 1er niveau). */
  formatId?: string | null;
  /** Sous-recettes a ne pas developper (ex: deja couvertes par le stock semi-finis). */
  skipSubRecipe?: (subRecipeId: string) => boolean;
  /** Recoit les anomalies rencontrees (compo vide, cycle) — memes messages que plan.warnings. */
  warnings?: string[];
}

/**
 * Accumule les besoins ingredients (en unite de base) pour produire `units`
 * unites de la recette, en descendant recursivement dans les sous-recettes,
 * quel que soit le mode de nomenclature (legacy ou compose).
 */
export async function collectIngredientNeedsForUnits(
  client: QueryClient,
  recipeId: string,
  units: number,
  addNeed: (ingredientId: string, qty: number) => void,
  opts: CollectNeedsOptions = {}
): Promise<void> {
  const comp = await getCompositionForNeeds(client, recipeId, opts.formatId ?? null);
  if (!comp) return;
  if (comp.isEmpty && opts.warnings) {
    opts.warnings.push(`La recette "${comp.recipeName}" n'a aucune composition (mode ${comp.mode}) : besoins ingredients non calcules.`);
  }
  await walk(client, comp, units / comp.batchDivisor, addNeed, opts, [recipeId], new Set());
}

async function walk(
  client: QueryClient,
  comp: RecipeComposition,
  batches: number,
  addNeed: (ingredientId: string, qty: number) => void,
  opts: CollectNeedsOptions,
  path: string[],
  warnedIngredients: Set<string>
): Promise<void> {
  for (const ing of comp.ingredients) {
    if (ing.conversionUncertain && opts.warnings && !warnedIngredients.has(ing.ingredientId)) {
      warnedIngredients.add(ing.ingredientId);
      opts.warnings.push(
        `Conversion poids/volume impossible pour "${ing.name}" (recette en ${ing.unitEntered}, stock en ${ing.unit}) : renseigner la masse volumique (densité) de l'ingrédient. Quantité prise telle quelle.`
      );
    }
    addNeed(ing.ingredientId, ing.qtyPerBatch * batches);
  }
  for (const sub of comp.subRecipes) {
    if (opts.skipSubRecipe && opts.skipSubRecipe(sub.subRecipeId)) continue;
    if (path.includes(sub.subRecipeId)) {
      if (opts.warnings) {
        opts.warnings.push(`Cycle de composition detecte (${comp.recipeName} -> ${sub.name}) : branche ignoree pour les besoins.`);
      }
      continue;
    }
    if (path.length >= MAX_DEPTH) {
      if (opts.warnings) {
        opts.warnings.push(`Profondeur de composition > ${MAX_DEPTH} sur "${sub.name}" : branche tronquee.`);
      }
      continue;
    }
    const childComp = await getCompositionForNeeds(client, sub.subRecipeId, null);
    if (!childComp) continue;
    // La quantite consommee est exprimee en unites de rendement de l'enfant
    // (kg de creme, pieces de fond...) : nombre de lots de composition de
    // l'enfant = quantite BRUTE (la perte standard majore la matiere, comme
    // dans v_recipe_total_cost) / yield_quantity — identique au frac de la vue
    // et a l'ancienne recursion legacy.
    const childBatches = (sub.grossQtyPerBatch / sub.yieldQuantity) * batches;
    await walk(client, childComp, childBatches, addNeed, opts, [...path, sub.subRecipeId], warnedIngredients);
  }
}
