// Source unique de la nomenclature pour le calcul des BESOINS de production
// (confirmation de plan / BSI, deduction stock, detection semi-finis, analyse).
//
// Les recettes en mode 'compose' stockent leur composition dans recipe_components /
// recipe_format_components. Pas 2b-1 : l'ancien modèle (lignes à plat) n'est plus lu ;
// une fiche sans nomenclature a une composition vide.
//
// Semantique alignee sur v_recipe_total_cost_v2 (migration 205) :
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
  /** True si aucune conversion n'existe entre l'unité saisie et l'unité de stock
   *  (ex. : « 3 unit » d'une matière stockée au kilo, sans poids de pièce) : le besoin
   *  n'est pas chiffrable, qtyPerBatch vaut 0 et l'appelant remonte un avertissement. */
  conversionImpossible: boolean;
  /** Mig 678 : quantité par fournée entière (vanille par cuve, décor par cadre), arrondie à
   *  la fournée supérieure au lieu de suivre la fraction de fournée. */
  fixed: boolean;
}

export interface CompositionSubRecipe {
  subRecipeId: string;
  name: string;
  isBase: boolean;
  /** Sous-ensemble fantôme (mig 588) : jamais stocké, composants tirés dans l'ordre parent. */
  isPhantom: boolean;
  yieldUnit: string;
  yieldQuantity: number;
  /** Quantite utilisable par lot de composition, en unite de rendement de la sous-recette. */
  netQtyPerBatch: number;
  /** Quantite a produire (brut de perte_standard_pct) pour obtenir netQtyPerBatch. */
  grossQtyPerBatch: number;
  /** True si l'unité saisie ne se convertit pas dans l'unité de rendement de la base. */
  conversionImpossible: boolean;
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

const MAX_DEPTH = 12; // meme plafond que v_recipe_total_cost_v2 (mig 204)

export async function getCompositionForNeeds(
  client: QueryClient,
  recipeId: string,
  formatId?: string | null
): Promise<RecipeComposition | null> {
  const recResult = await client.query(
    `SELECT r.id, r.name, r.yield_quantity, r.yield_unit, r.mode_cout,
            r.compo_par_piece, r.pieces_par_fournee,
            df.nb_par_defaut AS default_format_nb,
            CASE WHEN df.rendement_unite = 'kg' AND df.rendement_kg > 0 THEN df.rendement_kg END AS default_format_kg
     FROM recipes r
     LEFT JOIN LATERAL (
       SELECT rf.nb_par_defaut, rf.rendement_unite, rf.rendement_kg FROM recipe_formats rf
        WHERE rf.recipe_id = r.id AND rf.is_active = true
        ORDER BY rf.is_default DESC, rf.ordre LIMIT 1
     ) df ON true
     WHERE r.id = $1`,
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
    // Mig 613 : format au kilo → la fournée donne rendement_kg kilos ; nb_par_defaut y est
    // un reste sans valeur (5 pour une « Bassine 5 kg » qui rend 2,9 kg).
    let formatKg: number | null = null;

    if (formatId) {
      // Le format doit appartenir a la recette : un format_id etranger sur un
      // item de plan ne doit pas injecter la composition d'une autre recette.
      const fmt = await client.query(
        `SELECT nb_par_defaut, CASE WHEN rendement_unite = 'kg' AND rendement_kg > 0 THEN rendement_kg END AS rendement_kg
           FROM recipe_formats WHERE id = $1 AND recipe_id = $2`,
        [formatId, recipeId]
      );
      if (fmt.rows[0]) {
        const fmtRows = await client.query(componentQuery('recipe_format_components', 'format_id'), [formatId]);
        if (fmtRows.rows.length > 0) {
          rows = fmtRows.rows;
          source = 'recipe_format_components';
          formatNb = parseInt(fmt.rows[0].nb_par_defaut);
          formatKg = fmt.rows[0].rendement_kg != null ? parseFloat(fmt.rows[0].rendement_kg) : null;
        }
      }
    }
    if (rows.length === 0) {
      rows = (await client.query(componentQuery('recipe_components', 'recipe_id'), [recipeId])).rows;
      source = 'recipe_components';
      // recipe_components est le miroir du format par défaut : son rendement kilo s'applique.
      formatKg = rec.default_format_kg != null ? parseFloat(rec.default_format_kg) : null;
    }

    if (rows.length > 0) {
      // Diviseur : la compo decrit 1 piece, ou 1 fournee de `rendement` pieces — ou de
      // `rendement_kg` kilos pour un format au kilo (mig 613). Sans ce cas, 7 kg de crème
      // pâtissière (fournée de 2,9 kg, format « Bassine 5 kg ») comptaient 7/5 = 1,4 fournée
      // au lieu de 2,41 : besoins, sorties de stock et théorique sous-estimés de 42 %.
      let batchDivisor = 1;
      if (rec.compo_par_piece !== true) {
        const rendement = (formatKg && formatKg > 0 ? formatKg : null)
          ?? (formatNb && formatNb > 0 ? formatNb : null)
          ?? (rec.pieces_par_fournee && parseInt(rec.pieces_par_fournee) > 0 ? parseInt(rec.pieces_par_fournee) : null)
          ?? (rec.default_format_nb && parseInt(rec.default_format_nb) > 0 ? parseInt(rec.default_format_nb) : null)
          ?? yieldQty;
        batchDivisor = rendement > 0 ? rendement : 1;
      }
      return {
        recipeId, recipeName: rec.name, mode: 'compose', source, batchDivisor,
        ingredients: rows.filter(r => r.source_ingredient_id).map(r => {
          const q = ingredientQty(r);
          return {
            ingredientId: r.source_ingredient_id,
            name: r.ingredient_name,
            unit: r.ingredient_unit,
            qtyPerBatch: q ?? 0,
            qtyEntered: parseFloat(r.qty_entered),
            unitEntered: r.unit_entered,
            conversionUncertain: r.conv_incertaine === true,
            conversionImpossible: q === null,
            fixed: r.quantite_fixe === true,
          };
        }),
        subRecipes: rows.filter(r => r.source_recipe_id).map(r => {
          const net = num(r.qty_sub_net);
          const gross = num(r.qty_sub_gross);
          return {
            subRecipeId: r.source_recipe_id,
            name: r.sub_name,
            isBase: r.sub_is_base === true,
            isPhantom: r.sub_is_phantom === true,
            yieldUnit: r.sub_yield_unit || 'unit',
            yieldQuantity: parseFloat(r.sub_yield_quantity) > 0 ? parseFloat(r.sub_yield_quantity) : 1,
            netQtyPerBatch: net ?? 0,
            grossQtyPerBatch: gross ?? net ?? 0,
            conversionImpossible: net === null,
          };
        }),
        isEmpty: false,
      };
    }
    // Compose sans composants (mode bascule mais compo jamais saisie) : composition vide.
  }

  // Pas 2b-1 : l'ancien modèle n'est plus lu. Une fiche hors mode composé, ou composée
  // sans aucun composant, n'a pas de composition (le type garde 'legacy' pour les appelants).
  return {
    recipeId, recipeName: rec.name, mode: 'legacy', source: 'legacy', batchDivisor: yieldQty,
    ingredients: [], subRecipes: [], isEmpty: true,
  };
}

/** Nombre fini, ou null : fn_convert_factor renvoie NULL quand aucune conversion n'existe. */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

const MASS_KG: Record<string, number> = { mg: 1e-6, g: 1e-3, kg: 1 };
const VOLUME_L: Record<string, number> = { ml: 1e-3, cl: 1e-2, dl: 1e-1, l: 1 };

/**
 * Quantité d'une ligne matière dans l'unité de stock, ou null si elle n'est pas chiffrable.
 *
 * Audit 2026-11 C-09 : la conversion SQL renvoie NULL quand elle n'existe pas ; le
 * `parseFloat(null)` qui suivait donnait NaN, propagé jusqu'aux besoins et au bon de sortie.
 * Poids ↔ volume sans densité : 1 kg = 1 l, la même convention que l'éditeur de fiche
 * (l'avertissement « densité manquante » est déjà remonté). Tout autre cas : null.
 */
function ingredientQty(r: Record<string, unknown>): number | null {
  const direct = num(r.qty_ing_base);
  if (direct !== null) return direct;
  const from = String(r.unit_entered ?? '').toLowerCase();
  const to = String(r.ingredient_unit ?? '').toLowerCase();
  const entered = num(r.qty_entered);
  if (entered === null) return null;
  const k = from in MASS_KG && to in VOLUME_L ? MASS_KG[from] / VOLUME_L[to]
    : from in VOLUME_L && to in MASS_KG ? VOLUME_L[from] / MASS_KG[to]
    : null;
  if (k === null) return null;
  const loss = Math.min(Math.max(num(r.perte_pct) ?? 0, 0), 99.99);
  return (entered * k) / (1 - loss / 100);
}

function componentQuery(table: string, keyColumn: string): string {
  // Mig 265 : perte_pct ligne majore la quantite BRUTE consommee (qty_saisie
  // = net, qty_brute = net / (1 - perte/100)). Meme regle que la perte
  // standard sur la sous-recette (majoration cumulee : perte assemblage
  // + perte cuisson sub-recette). Defaut 0 -> facteur 1, comportement inchange.
  return `
    SELECT c.source_recipe_id, c.source_ingredient_id,
           ing.name AS ingredient_name, ing.unit AS ingredient_unit,
           c.quantite AS qty_entered, c.unite AS unit_entered, c.perte_pct, c.quantite_fixe,
           (c.quantite * fn_convert_factor(c.unite, ing.unit::text, 'ingredient', ing.id))
             / NULLIF(1 - COALESCE(c.perte_pct, 0) / 100, 0) AS qty_ing_base,
           (((lower(c.unite) IN ('mg','g','kg') AND lower(ing.unit::text) IN ('ml','cl','dl','l'))
              OR (lower(c.unite) IN ('ml','cl','dl','l') AND lower(ing.unit::text) IN ('mg','g','kg')))
             AND ing.densite_kg_l IS NULL) AS conv_incertaine,
           br.name AS sub_name, br.is_base AS sub_is_base, COALESCE(br.is_phantom, false) AS sub_is_phantom,
           br.yield_unit AS sub_yield_unit, br.yield_quantity AS sub_yield_quantity,
           c.quantite * fn_convert_factor(c.unite, br.yield_unit, NULL, NULL) AS qty_sub_net,
           COALESCE(
             (c.quantite * fn_convert_factor(c.unite, br.yield_unit, NULL, NULL))
               / NULLIF(1 - COALESCE(br.perte_standard_pct, 0) / 100, 0)
               / NULLIF(1 - COALESCE(c.perte_pct, 0) / 100, 0),
             (c.quantite * fn_convert_factor(c.unite, br.yield_unit, NULL, NULL))
               / NULLIF(1 - COALESCE(c.perte_pct, 0) / 100, 0)
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
    if (ing.conversionImpossible) {
      if (opts.warnings && !warnedIngredients.has(ing.ingredientId)) {
        warnedIngredients.add(ing.ingredientId);
        opts.warnings.push(
          `Besoin non calculé pour "${ing.name}" dans "${comp.recipeName}" : aucune conversion entre ${ing.unitEntered} (fiche) et ${ing.unit} (stock). Renseigner la conversion de l'article ou saisir la ligne dans l'unité de stock.`
        );
      }
      continue;
    }
    if (ing.conversionUncertain && opts.warnings && !warnedIngredients.has(ing.ingredientId)) {
      warnedIngredients.add(ing.ingredientId);
      opts.warnings.push(
        `Conversion poids/volume impossible pour "${ing.name}" (recette en ${ing.unitEntered}, stock en ${ing.unit}) : renseigner la masse volumique (densité) de l'ingrédient. Quantité prise telle quelle.`
      );
    }
    // Mig 678 : composant fixe = par fournée commencée (2,3 fournées → 3 fois la quantité).
    addNeed(ing.ingredientId, ing.qtyPerBatch * (ing.fixed ? Math.ceil(batches - 1e-9) : batches));
  }
  for (const sub of comp.subRecipes) {
    if (opts.skipSubRecipe && opts.skipSubRecipe(sub.subRecipeId)) continue;
    if (sub.conversionImpossible) {
      if (opts.warnings) {
        opts.warnings.push(
          `Besoin non calculé pour la préparation "${sub.name}" dans "${comp.recipeName}" : l'unité saisie ne se convertit pas en ${sub.yieldUnit} (unité de rendement de la préparation).`
        );
      }
      continue;
    }
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
    // dans v_recipe_total_cost_v2) / yield_quantity — identique au frac de la vue
    // et a l'ancienne recursion legacy.
    const childBatches = (sub.grossQtyPerBatch / sub.yieldQuantity) * batches;
    await walk(client, childComp, childBatches, addNeed, opts, [...path, sub.subRecipeId], warnedIngredients);
  }
}
