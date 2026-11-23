import { usePermissions } from '../context/PermissionsContext';

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
  return {
    batchMode: hasFeature('mode_fournee'),
    recipe, recipes,
    recipeLc: recipe.toLowerCase(),
    recipesLc: recipes.toLowerCase(),
    basePreps: sectorLabel('base_preps', 'Préparations de base'),
    basePrep: sectorLabel('base_prep', 'Préparation de base'),
    batch: sectorLabel('batch', 'Fournée'),
    plan: sectorLabel('production_plan', 'Plan de production'),
    ingredient, ingredients,
    ingredientLc: ingredient.toLowerCase(),
    ingredientsLc: ingredients.toLowerCase(),
    weighingZone: sectorLabel('weighing_zone', 'Pesage'),
    reserveZone: sectorLabel('reserve_zone', 'Économat'),
  };
}
