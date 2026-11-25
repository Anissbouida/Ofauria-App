import { usePermissions } from '../context/PermissionsContext';

/** Pluriel simple d'un terme du secteur : « Fournée » → « Fournées », « Lot de fabrication » → « Lots de fabrication ». */
function pluralFr(term: string): string {
  const m = term.match(/^(.*?)(\s+(?:de|du|des|en|à)\s.*|\s+d['’].*)?$/i);
  const head = m?.[1] ?? term; const tail = m?.[2] ?? '';
  return head.split(' ').map(w => /[sxz]$/i.test(w) || !w ? w : /(eau|au|eu)$/i.test(w) ? `${w}x` : `${w}s`).join(' ') + tail;
}

/**
 * Termes métier des écrans de fabrication (M8-03), lus dans le vocabulaire du secteur
 * (sector_labels, mig 495 / 514 / 580). Valeur par défaut = terme actuel de la boulangerie.
 * `batchMode` : option « saisie par fournée et coupe » (boulangerie).
 */
export function useProdTerms() {
  const { sectorLabel, hasFeature } = usePermissions();
  const recipe = sectorLabel('recipe', 'Recette');
  const recipes = sectorLabel('recipes', 'Recettes');
  // Matière consommée (étape 10d, mig 647) : « Ingrédient » en alimentaire, « Matière » ailleurs.
  // Le genre change selon le secteur : n'écrire ces termes que dans des tournures sans accord
  // (titre, libellé suivi de « : », pluriel avec des/les/ces), jamais après un/une/nouvel/aucun.
  const ingredient = sectorLabel('ingredient', 'Ingrédient');
  const ingredients = sectorLabel('ingredients', 'Ingrédients');
  // Lot de fabrication (« Fournée » en boulangerie, « Lot », « Série »… ailleurs). Genre variable :
  // mêmes précautions que ci-dessus (par …, de …, N …, jamais la/une/entière/planifiées).
  const batch = sectorLabel('batch', 'Fournée');
  const batches = pluralFr(batch);
  return {
    batchMode: hasFeature('mode_fournee'),
    recipe, recipes,
    recipeLc: recipe.toLowerCase(),
    recipesLc: recipes.toLowerCase(),
    basePreps: sectorLabel('base_preps', 'Préparations de base'),
    basePrep: sectorLabel('base_prep', 'Préparation de base'),
    batch, batches,
    batchLc: batch.toLowerCase(),
    batchesLc: batches.toLowerCase(),
    plan: sectorLabel('production_plan', 'Plan de production'),
    ingredient, ingredients,
    ingredientLc: ingredient.toLowerCase(),
    ingredientsLc: ingredients.toLowerCase(),
    weighingZone: sectorLabel('weighing_zone', 'Pesage'),
    reserveZone: sectorLabel('reserve_zone', 'Économat'),
  };
}
