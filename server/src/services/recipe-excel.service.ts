import * as XLSX from 'xlsx';

/**
 * Parser/generateur xlsx pour les recettes (recettes produits + recettes de base).
 *
 * Format multi-feuilles :
 *   Feuille 1 "Recettes"      : Nom | Base? | Produit | Rendement | Unite rendement | Marge | Instructions
 *   Feuille 2 "Ingredients"   : Recette | Ingredient | Quantite | Unite
 *   Feuille 3 "Sous-recettes" : Recette | Sous-recette | Quantite
 *   Feuille 4 "Emballages"    : Recette | Emballage | Quantite | Unite
 *
 * Cle de correlation entre feuilles : nom de la recette (case-insensitive).
 * Lookup des entites liees (ingredients, sous-recettes, emballages, produits) par
 * nom (case-insensitive) — c'est le seul moyen d'avoir un xlsx lisible par un humain.
 *
 * L'export inclut en plus (lecture seule, ignore a la re-importation) :
 *   - Cout total (DH)        — depuis la vue v_recipe_total_cost
 *   - Cout par unite (DH)
 *
 * Les etapes de production (etapes) ne sont PAS exportees ni importees via xlsx
 * (structure trop complexe : checklist, timers, controle qualite). Elles restent
 * editables uniquement via l'interface RecipesPage.
 */

export type RecipeUnit = 'kg' | 'g' | 'l' | 'cl' | 'ml' | 'unit';
const ALLOWED_UNITS: ReadonlySet<string> = new Set(['kg', 'g', 'l', 'cl', 'ml', 'unit']);

function normalizeUnit(raw: unknown): RecipeUnit | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (ALLOWED_UNITS.has(s)) return s as RecipeUnit;
  if (s === 'kilogramme' || s === 'kilo' || s === 'kilos') return 'kg';
  if (s === 'gramme' || s === 'grammes') return 'g';
  if (s === 'litre' || s === 'litres') return 'l';
  if (s === 'centilitre' || s === 'centilitres') return 'cl';
  if (s === 'millilitre' || s === 'millilitres') return 'ml';
  if (s === 'unite' || s === 'u' || s === 'unites' || s === 'piece' || s === 'pieces') return 'unit';
  return null;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function toCleanString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function toBool(v: unknown): boolean | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).trim().toLowerCase();
  if (['true', 'oui', 'yes', 'o', 'y', '1', 'vrai', 'x'].includes(s)) return true;
  if (['false', 'non', 'no', 'n', '0', 'faux', ''].includes(s)) return false;
  return null;
}

export interface ParsedRecipeMain {
  sourceRow: number;
  name: string;
  isBase: boolean;
  productName: string | null;        // nom du produit lie (null si recette de base)
  yieldQuantity: number;
  yieldUnit: RecipeUnit;
  marginMultiplier: number | null;   // null => garde la valeur par defaut serveur (3)
  instructions: string | null;
}

export interface ParsedRecipeIngredient {
  sourceRow: number;
  recipeName: string;
  ingredientName: string;
  quantity: number;
  unit: RecipeUnit;
}

export interface ParsedRecipeSubRecipe {
  sourceRow: number;
  recipeName: string;
  subRecipeName: string;
  quantity: number;
}

export interface ParsedRecipePackaging {
  sourceRow: number;
  recipeName: string;
  packagingName: string;
  quantity: number;
  unit: string | null;
}

export interface RecipeParseError {
  sheet: string;
  sourceRow: number;
  message: string;
}

export interface ParsedRecipesWorkbook {
  recipes: ParsedRecipeMain[];
  ingredients: ParsedRecipeIngredient[];
  subRecipes: ParsedRecipeSubRecipe[];
  packaging: ParsedRecipePackaging[];
  errors: RecipeParseError[];
  warnings: string[];
}

const SHEET_RECIPES = 'Recettes';
const SHEET_INGREDIENTS = 'Ingredients';
const SHEET_SUB_RECIPES = 'Sous-recettes';
const SHEET_PACKAGING = 'Emballages';

/** Recupere une feuille par nom (case-insensitive, tolere les accents). */
function findSheet(wb: XLSX.WorkBook, targetName: string): XLSX.WorkSheet | null {
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const target = norm(targetName);
  for (const name of wb.SheetNames) {
    if (norm(name) === target) return wb.Sheets[name];
  }
  return null;
}

/**
 * Parse un workbook xlsx de recettes.
 * Premiere ligne de chaque feuille = en-tete (ignoree).
 * Lignes vides ignorees. Lookup par nom (case-insensitive).
 */
export function parseRecipeWorkbook(buffer: Buffer): ParsedRecipesWorkbook {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  if (wb.SheetNames.length === 0) {
    throw new Error('Aucune feuille trouvee dans le fichier');
  }

  const errors: RecipeParseError[] = [];
  const warnings: string[] = [];

  // === Feuille 1 : Recettes (obligatoire) ===
  const recipesSheet = findSheet(wb, SHEET_RECIPES);
  if (!recipesSheet) {
    throw new Error(`Feuille "${SHEET_RECIPES}" introuvable. Le fichier doit contenir une feuille nommee "${SHEET_RECIPES}".`);
  }
  const recipesAoa = XLSX.utils.sheet_to_json<unknown[]>(recipesSheet, {
    header: 1, defval: null, blankrows: false,
  });
  if (recipesAoa.length < 2) {
    throw new Error(`Feuille "${SHEET_RECIPES}" vide (ligne 1 = en-tete, donnees a partir de la ligne 2)`);
  }

  const recipes: ParsedRecipeMain[] = [];
  const seenRecipeNames = new Set<string>();

  for (let i = 1; i < recipesAoa.length; i++) {
    const row = recipesAoa[i] || [];
    const sourceRow = i + 1;
    const allEmpty = row.every(c => c === null || c === undefined || String(c).trim() === '');
    if (allEmpty) continue;

    const name = toCleanString(row[0]);
    if (!name) {
      errors.push({ sheet: SHEET_RECIPES, sourceRow, message: 'Nom de recette manquant (colonne A)' });
      continue;
    }
    const nameKey = name.toUpperCase();
    if (seenRecipeNames.has(nameKey)) {
      errors.push({ sheet: SHEET_RECIPES, sourceRow, message: `Doublon dans le fichier : "${name}" apparait plusieurs fois` });
      continue;
    }
    seenRecipeNames.add(nameKey);

    const isBaseRaw = row[1];
    const isBase = toBool(isBaseRaw);
    if (isBase === null && isBaseRaw !== null && isBaseRaw !== undefined && String(isBaseRaw).trim() !== '') {
      errors.push({ sheet: SHEET_RECIPES, sourceRow, message: `Colonne "Base?" invalide : "${isBaseRaw}". Utiliser oui/non, true/false, 1/0.` });
      continue;
    }
    const baseFlag = isBase ?? false;

    const productName = toCleanString(row[2]);
    if (baseFlag && productName) {
      warnings.push(`Ligne ${sourceRow} (${SHEET_RECIPES}) : "${name}" est marquee comme recette de base, le produit "${productName}" sera ignore.`);
    }

    const yieldQuantity = toNumber(row[3]);
    if (yieldQuantity === null || yieldQuantity <= 0) {
      errors.push({ sheet: SHEET_RECIPES, sourceRow, message: `Rendement invalide (colonne D) : "${row[3] ?? ''}". Doit etre un nombre positif.` });
      continue;
    }

    const yieldUnit = normalizeUnit(row[4]);
    if (!yieldUnit) {
      errors.push({ sheet: SHEET_RECIPES, sourceRow, message: `Unite de rendement invalide (colonne E) : "${row[4] ?? ''}". Valeurs : kg, g, l, cl, ml, unit` });
      continue;
    }

    const marginRaw = row[5];
    let marginMultiplier: number | null = null;
    if (marginRaw !== null && marginRaw !== undefined && String(marginRaw).trim() !== '') {
      const m = toNumber(marginRaw);
      if (m === null || m <= 0) {
        errors.push({ sheet: SHEET_RECIPES, sourceRow, message: `Multiplicateur de marge invalide (colonne F) : "${marginRaw}"` });
        continue;
      }
      marginMultiplier = m;
    }

    const instructions = toCleanString(row[6]);

    recipes.push({
      sourceRow, name, isBase: baseFlag,
      productName: baseFlag ? null : productName,
      yieldQuantity, yieldUnit, marginMultiplier, instructions,
    });
  }

  // === Feuille 2 : Ingredients (optionnelle) ===
  const ingredients: ParsedRecipeIngredient[] = [];
  const ingredientsSheet = findSheet(wb, SHEET_INGREDIENTS);
  if (ingredientsSheet) {
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ingredientsSheet, { header: 1, defval: null, blankrows: false });
    for (let i = 1; i < aoa.length; i++) {
      const row = aoa[i] || [];
      const sourceRow = i + 1;
      const allEmpty = row.every(c => c === null || c === undefined || String(c).trim() === '');
      if (allEmpty) continue;

      const recipeName = toCleanString(row[0]);
      const ingredientName = toCleanString(row[1]);
      const quantity = toNumber(row[2]);
      const unit = normalizeUnit(row[3]);

      if (!recipeName) {
        errors.push({ sheet: SHEET_INGREDIENTS, sourceRow, message: 'Nom de recette manquant (colonne A)' });
        continue;
      }
      if (!ingredientName) {
        errors.push({ sheet: SHEET_INGREDIENTS, sourceRow, message: 'Nom d\'ingredient manquant (colonne B)' });
        continue;
      }
      if (quantity === null || quantity <= 0) {
        errors.push({ sheet: SHEET_INGREDIENTS, sourceRow, message: `Quantite invalide (colonne C) : "${row[2] ?? ''}"` });
        continue;
      }
      if (!unit) {
        errors.push({ sheet: SHEET_INGREDIENTS, sourceRow, message: `Unite invalide (colonne D) : "${row[3] ?? ''}". Valeurs : kg, g, l, cl, ml, unit` });
        continue;
      }
      ingredients.push({ sourceRow, recipeName, ingredientName, quantity, unit });
    }
  }

  // === Feuille 3 : Sous-recettes (optionnelle) ===
  const subRecipes: ParsedRecipeSubRecipe[] = [];
  const subSheet = findSheet(wb, SHEET_SUB_RECIPES);
  if (subSheet) {
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(subSheet, { header: 1, defval: null, blankrows: false });
    for (let i = 1; i < aoa.length; i++) {
      const row = aoa[i] || [];
      const sourceRow = i + 1;
      const allEmpty = row.every(c => c === null || c === undefined || String(c).trim() === '');
      if (allEmpty) continue;

      const recipeName = toCleanString(row[0]);
      const subRecipeName = toCleanString(row[1]);
      const quantity = toNumber(row[2]);

      if (!recipeName) {
        errors.push({ sheet: SHEET_SUB_RECIPES, sourceRow, message: 'Nom de recette manquant (colonne A)' });
        continue;
      }
      if (!subRecipeName) {
        errors.push({ sheet: SHEET_SUB_RECIPES, sourceRow, message: 'Nom de sous-recette manquant (colonne B)' });
        continue;
      }
      if (quantity === null || quantity <= 0) {
        errors.push({ sheet: SHEET_SUB_RECIPES, sourceRow, message: `Quantite invalide (colonne C) : "${row[2] ?? ''}"` });
        continue;
      }
      subRecipes.push({ sourceRow, recipeName, subRecipeName, quantity });
    }
  }

  // === Feuille 4 : Emballages (optionnelle) ===
  const packaging: ParsedRecipePackaging[] = [];
  const pkgSheet = findSheet(wb, SHEET_PACKAGING);
  if (pkgSheet) {
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(pkgSheet, { header: 1, defval: null, blankrows: false });
    for (let i = 1; i < aoa.length; i++) {
      const row = aoa[i] || [];
      const sourceRow = i + 1;
      const allEmpty = row.every(c => c === null || c === undefined || String(c).trim() === '');
      if (allEmpty) continue;

      const recipeName = toCleanString(row[0]);
      const packagingName = toCleanString(row[1]);
      const quantity = toNumber(row[2]);
      const unit = toCleanString(row[3]);

      if (!recipeName) {
        errors.push({ sheet: SHEET_PACKAGING, sourceRow, message: 'Nom de recette manquant (colonne A)' });
        continue;
      }
      if (!packagingName) {
        errors.push({ sheet: SHEET_PACKAGING, sourceRow, message: 'Nom d\'emballage manquant (colonne B)' });
        continue;
      }
      if (quantity === null || quantity <= 0) {
        errors.push({ sheet: SHEET_PACKAGING, sourceRow, message: `Quantite invalide (colonne C) : "${row[2] ?? ''}"` });
        continue;
      }
      packaging.push({ sourceRow, recipeName, packagingName, quantity, unit });
    }
  }

  // === Validation croisee : chaque ingredient/sous-recette/emballage doit reference une recette listee ===
  const recipeNamesUpper = new Set(recipes.map(r => r.name.toUpperCase()));
  for (const ing of ingredients) {
    if (!recipeNamesUpper.has(ing.recipeName.toUpperCase())) {
      errors.push({
        sheet: SHEET_INGREDIENTS,
        sourceRow: ing.sourceRow,
        message: `Recette "${ing.recipeName}" introuvable dans la feuille "${SHEET_RECIPES}"`,
      });
    }
  }
  for (const sr of subRecipes) {
    if (!recipeNamesUpper.has(sr.recipeName.toUpperCase())) {
      errors.push({
        sheet: SHEET_SUB_RECIPES,
        sourceRow: sr.sourceRow,
        message: `Recette "${sr.recipeName}" introuvable dans la feuille "${SHEET_RECIPES}"`,
      });
    }
  }
  for (const pk of packaging) {
    if (!recipeNamesUpper.has(pk.recipeName.toUpperCase())) {
      errors.push({
        sheet: SHEET_PACKAGING,
        sourceRow: pk.sourceRow,
        message: `Recette "${pk.recipeName}" introuvable dans la feuille "${SHEET_RECIPES}"`,
      });
    }
  }

  return { recipes, ingredients, subRecipes, packaging, errors, warnings };
}

// ============================================================================
// EXPORT — Generation xlsx multi-feuilles
// ============================================================================

export interface RecipeExportMain {
  name: string;
  isBase: boolean;
  productName: string | null;
  yieldQuantity: number;
  yieldUnit: string;
  marginMultiplier: number | null;
  instructions: string | null;
  totalCost?: number | null;        // lecture seule
  costPerUnit?: number | null;      // lecture seule
}

export interface RecipeExportIngredient {
  recipeName: string;
  ingredientName: string;
  quantity: number;
  unit: string;
}

export interface RecipeExportSubRecipe {
  recipeName: string;
  subRecipeName: string;
  quantity: number;
}

export interface RecipeExportPackaging {
  recipeName: string;
  packagingName: string;
  quantity: number;
  unit: string | null;
}

export interface RecipeExportPayload {
  recipes: RecipeExportMain[];
  ingredients: RecipeExportIngredient[];
  subRecipes: RecipeExportSubRecipe[];
  packaging: RecipeExportPackaging[];
}

/**
 * Genere un workbook xlsx avec 4 feuilles a partir des donnees de recettes.
 */
export function generateRecipeWorkbook(payload: RecipeExportPayload, opts: { includeCost?: boolean } = {}): Buffer {
  const includeCost = opts.includeCost !== false;

  // === Feuille 1 : Recettes ===
  const recipeHeader = ['Nom', 'Base?', 'Produit', 'Rendement', 'Unite rendement', 'Marge', 'Instructions'];
  if (includeCost) recipeHeader.push('Cout total (DH)', 'Cout par unite (DH)');

  const recipeData: (string | number | null)[][] = [recipeHeader];
  for (const r of payload.recipes) {
    const row: (string | number | null)[] = [
      r.name,
      r.isBase ? 'oui' : 'non',
      r.productName || '',
      r.yieldQuantity,
      r.yieldUnit,
      r.marginMultiplier ?? '',
      r.instructions || '',
    ];
    if (includeCost) {
      const totalCost = typeof r.totalCost === 'number' ? Number(r.totalCost.toFixed(2)) : 0;
      const costPerUnit = typeof r.costPerUnit === 'number' ? Number(r.costPerUnit.toFixed(4)) : 0;
      row.push(totalCost, costPerUnit);
    }
    recipeData.push(row);
  }
  const recipeSheet = XLSX.utils.aoa_to_sheet(recipeData);
  recipeSheet['!cols'] = [
    { wch: 32 }, { wch: 6 }, { wch: 28 }, { wch: 10 }, { wch: 8 }, { wch: 7 }, { wch: 50 },
  ];
  if (includeCost) {
    recipeSheet['!cols'].push({ wch: 14 }, { wch: 16 });
  }

  // === Feuille 2 : Ingredients ===
  const ingHeader = ['Recette', 'Ingredient', 'Quantite', 'Unite'];
  const ingData: (string | number | null)[][] = [ingHeader];
  for (const ing of payload.ingredients) {
    ingData.push([ing.recipeName, ing.ingredientName, ing.quantity, ing.unit]);
  }
  const ingSheet = XLSX.utils.aoa_to_sheet(ingData);
  ingSheet['!cols'] = [{ wch: 32 }, { wch: 32 }, { wch: 10 }, { wch: 8 }];

  // === Feuille 3 : Sous-recettes ===
  const subHeader = ['Recette', 'Sous-recette', 'Quantite'];
  const subData: (string | number | null)[][] = [subHeader];
  for (const sr of payload.subRecipes) {
    subData.push([sr.recipeName, sr.subRecipeName, sr.quantity]);
  }
  const subSheet = XLSX.utils.aoa_to_sheet(subData);
  subSheet['!cols'] = [{ wch: 32 }, { wch: 32 }, { wch: 10 }];

  // === Feuille 4 : Emballages ===
  const pkgHeader = ['Recette', 'Emballage', 'Quantite', 'Unite'];
  const pkgData: (string | number | null)[][] = [pkgHeader];
  for (const pk of payload.packaging) {
    pkgData.push([pk.recipeName, pk.packagingName, pk.quantity, pk.unit || '']);
  }
  const pkgSheet = XLSX.utils.aoa_to_sheet(pkgData);
  pkgSheet['!cols'] = [{ wch: 32 }, { wch: 32 }, { wch: 10 }, { wch: 8 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, recipeSheet, SHEET_RECIPES);
  XLSX.utils.book_append_sheet(wb, ingSheet, SHEET_INGREDIENTS);
  XLSX.utils.book_append_sheet(wb, subSheet, SHEET_SUB_RECIPES);
  XLSX.utils.book_append_sheet(wb, pkgSheet, SHEET_PACKAGING);

  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return out as Buffer;
}
