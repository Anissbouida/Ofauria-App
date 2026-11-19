/**
 * Coût de revient d'un produit fabriqué, ramené à son unité de vente, à partir de la
 * recette choisie dans le formulaire produit (liste GET /recipes).
 *
 * Pourquoi : une fiche composée « par format » porte le coût de TOUTE la fournée
 * (total_cost, format par défaut) et son rendement dans le format (rendement =
 * nb_par_defaut), pas dans recipes.yield_quantity, qui reste à 1. Diviser par
 * yield_quantity prenait le coût d'une plaque de 60 pièces pour le coût d'une pièce
 * (scénario 1, constat 24 : 155,10 DH au lieu de 2,59 DH).
 *
 * - Vente au poids : coût au kilo = coût de la fournée ÷ poids de la fournée (kg).
 * - Saisie par pièce (compo_par_piece) : total_cost est déjà le coût d'une pièce.
 * - Sinon : coût de la fournée ÷ rendement du format par défaut, à défaut
 *   yield_quantity, à défaut 1.
 */
export type RecipeCostSource = {
  total_cost?: string | number | null;
  total_weight_kg?: string | number | null;
  /** Poids d'une fournée du format par défaut (fiche composée par format). */
  default_format_weight_kg?: string | number | null;
  rendement?: string | number | null;
  /** Mig 613 : rendement du format par défaut en pièces ('unit') ou en kilos ('kg'). */
  rendement_unite?: 'unit' | 'kg' | string | null;
  rendement_kg?: string | number | null;
  yield_quantity?: string | number | null;
  compo_par_piece?: boolean | null;
};

export type SaleUnit = 'unit' | 'weight' | 'person' | string;

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};

/** Diviseur appliqué au coût de la fournée pour obtenir une unité de vente. */
export function recipeYieldPerBatch(recipe: RecipeCostSource): number {
  if (recipe.compo_par_piece) return 1;
  const rendement = num(recipe.rendement);
  if (rendement > 0) return rendement;
  const yieldQty = num(recipe.yield_quantity);
  return yieldQty > 0 ? yieldQty : 1;
}

/** Rendement en kilos déclaré sur le format (mig 613), sinon 0. */
function declaredYieldKg(recipe: RecipeCostSource): number {
  if (recipe.compo_par_piece || recipe.rendement_unite !== 'kg') return 0;
  return num(recipe.rendement_kg);
}

/** Libellé du rendement proposé dans le formulaire produit : « 100 unités » ou « 2,1 kg ». */
export function recipeYieldLabel(recipe: RecipeCostSource): string {
  const kg = declaredYieldKg(recipe);
  if (kg > 0) return `${kg.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} kg`;
  const y = recipeYieldPerBatch(recipe);
  return `${y} unite${y > 1 ? 's' : ''}`;
}

/** Coût de revient par unité de vente (pièce, ou kilo pour une vente au poids). */
export function recipeUnitCost(recipe: RecipeCostSource, saleUnit: SaleUnit = 'unit'): number {
  const totalCost = num(recipe.total_cost);
  if (totalCost <= 0) return 0;
  if (saleUnit === 'weight') {
    // Rendement déclaré en kilos sur le format : c'est le poids vendable de la
    // fournée (pertes comprises), prioritaire sur le poids brut de la composition.
    const yieldKg = declaredYieldKg(recipe);
    if (yieldKg > 0) return totalCost / yieldKg;
    // Fiche par format : poids de la fournée du format par défaut (même périmètre que
    // total_cost). Ancienne composition : poids total de la recette.
    const weightKg = num(recipe.default_format_weight_kg) || num(recipe.total_weight_kg);
    if (weightKg > 0) return totalCost / weightKg;
  }
  return totalCost / recipeYieldPerBatch(recipe);
}
