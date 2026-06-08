import * as XLSX from 'xlsx';

/**
 * Parser/generateur xlsx pour le module Economat — ingredients.
 * Colonnes attendues (ligne 1 = en-tete) :
 *   A  Nom              (obligatoire)
 *   B  Categorie        (obligatoire, slug ou libelle FR)
 *   C  Unite            (obligatoire, kg|g|l|ml|unit)
 *   D  Cout unitaire    (obligatoire, decimal positif, DH)
 *   E  Fournisseur      (optionnel)
 *   F  Allergenes       (optionnel, separes par virgule)
 *
 * L'export ajoute en plus (lecture seule, ignore a la re-importation) :
 *   G  Stock total
 *   H  Economat
 *   I  Pesage
 *   J  Lots actifs
 *   K  DLC plus proche
 */

export type IngredientUnit = 'kg' | 'g' | 'l' | 'ml' | 'unit';
const ALLOWED_UNITS: ReadonlySet<string> = new Set(['kg', 'g', 'l', 'ml', 'unit']);

export const INGREDIENT_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'farines', label: 'Farines & Cereales' },
  { value: 'sucres', label: 'Sucres & Edulcorants' },
  { value: 'lait', label: 'Lait & Boissons lactees' },
  { value: 'cremes', label: 'Cremes' },
  { value: 'beurre', label: 'Beurre & Margarines' },
  { value: 'fromages', label: 'Fromages' },
  { value: 'produits_laitiers', label: 'Produits laitiers' },
  { value: 'oeufs', label: 'Oeufs & Ovoproduits' },
  { value: 'matieres_grasses', label: 'Matieres grasses & Huiles' },
  { value: 'chocolat', label: 'Chocolat & Cacao' },
  { value: 'fruits', label: 'Fruits & Purees' },
  { value: 'fruits_secs', label: 'Fruits secs & Oleagineux' },
  { value: 'viandes', label: 'Viandes & Volailles' },
  { value: 'poissons_fruits_de_mer', label: 'Poissons & Fruits de mer' },
  { value: 'legumes', label: 'Legumes' },
  { value: 'epices', label: 'Epices & Aromes' },
  { value: 'sel_vinaigre', label: 'Sel & Vinaigre' },
  { value: 'levures', label: 'Levures & Agents levants' },
  { value: 'gelifiants', label: 'Gelifiants' },
  { value: 'colorants', label: 'Colorants' },
  { value: 'decors', label: 'Decors & Garnitures' },
  { value: 'sauces', label: 'Sauces & Condiments' },
  { value: 'conserves', label: 'Conserves' },
  { value: 'preparations', label: 'Preparations' },
  { value: 'pates_riz', label: 'Pates & Riz' },
  { value: 'emballages', label: 'Emballages' },
  { value: 'autre', label: 'Autre' },
];

const CATEGORY_BY_LABEL = new Map<string, string>(
  INGREDIENT_CATEGORIES.map(c => [c.label.toUpperCase(), c.value])
);
const CATEGORY_VALUES = new Set(INGREDIENT_CATEGORIES.map(c => c.value));

export interface ParsedIngredientRow {
  sourceRow: number;           // 1-indexed (en-tete = 1, premiere donnee = 2)
  name: string;
  category: string;            // slug normalise
  unit: IngredientUnit;
  unitCost: number;            // DH
  supplier: string | null;
  allergens: string[];
}

export interface IngredientParseError {
  sourceRow: number;
  message: string;
}

export interface ParsedIngredientsWorkbook {
  rows: ParsedIngredientRow[];
  errors: IngredientParseError[];
  warnings: string[];
}

function normalizeUnit(raw: unknown): IngredientUnit | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (ALLOWED_UNITS.has(s)) return s as IngredientUnit;
  // Tolerance : libelle FR usuel
  if (s === 'kilogramme' || s === 'kilo' || s === 'kilos') return 'kg';
  if (s === 'gramme' || s === 'grammes') return 'g';
  if (s === 'litre' || s === 'litres') return 'l';
  if (s === 'millilitre' || s === 'millilitres') return 'ml';
  if (s === 'unite' || s === 'u' || s === 'unites' || s === 'piece' || s === 'pieces') return 'unit';
  return null;
}

function normalizeCategory(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Match exact sur le slug
  if (CATEGORY_VALUES.has(s)) return s;
  if (CATEGORY_VALUES.has(s.toLowerCase())) return s.toLowerCase();
  // Match insensible casse sur le libelle FR
  const slug = CATEGORY_BY_LABEL.get(s.toUpperCase());
  if (slug) return slug;
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

function parseAllergens(v: unknown): string[] {
  const s = toCleanString(v);
  if (!s) return [];
  return s.split(',').map(a => a.trim()).filter(Boolean);
}

/**
 * Parse un workbook xlsx d'ingredients. Premiere feuille utilisee.
 * Premiere ligne = en-tete (ignoree). Lignes vides ignorees.
 */
export function parseIngredientWorkbook(buffer: Buffer): ParsedIngredientsWorkbook {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new Error('Aucune feuille trouvee dans le fichier');
  }
  const sheet = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, blankrows: false });

  if (aoa.length < 2) {
    throw new Error('Fichier vide ou sans donnees (ligne 1 = en-tete)');
  }

  const rows: ParsedIngredientRow[] = [];
  const errors: IngredientParseError[] = [];
  const warnings: string[] = [];

  const seenNames = new Set<string>();

  // Demarre a la ligne 2 (index 1) — la ligne 1 est l'en-tete
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const sourceRow = i + 1;

    // Skip ligne completement vide
    const allEmpty = row.every(c => c === null || c === undefined || String(c).trim() === '');
    if (allEmpty) continue;

    const name = toCleanString(row[0]);
    const rawCategory = row[1];
    const rawUnit = row[2];
    const rawCost = row[3];
    const supplier = toCleanString(row[4]);
    const allergens = parseAllergens(row[5]);

    if (!name) {
      errors.push({ sourceRow, message: 'Nom manquant (colonne A)' });
      continue;
    }

    const nameKey = name.toUpperCase();
    if (seenNames.has(nameKey)) {
      errors.push({ sourceRow, message: `Doublon dans le fichier : "${name}" apparait plusieurs fois` });
      continue;
    }
    seenNames.add(nameKey);

    const category = normalizeCategory(rawCategory);
    if (!category) {
      errors.push({
        sourceRow,
        message: `Categorie invalide (colonne B) : "${rawCategory ?? ''}". Valeurs autorisees : ${INGREDIENT_CATEGORIES.map(c => c.value).join(', ')}`,
      });
      continue;
    }

    const unit = normalizeUnit(rawUnit);
    if (!unit) {
      errors.push({ sourceRow, message: `Unite invalide (colonne C) : "${rawUnit ?? ''}". Valeurs : kg, g, l, ml, unit` });
      continue;
    }

    const unitCost = toNumber(rawCost);
    if (unitCost === null) {
      errors.push({ sourceRow, message: `Cout unitaire invalide (colonne D) : "${rawCost ?? ''}"` });
      continue;
    }
    if (unitCost < 0) {
      errors.push({ sourceRow, message: `Cout unitaire negatif (colonne D) : ${unitCost}` });
      continue;
    }
    if (unitCost > 1_000_000) {
      warnings.push(`Ligne ${sourceRow} : cout unitaire tres eleve (${unitCost} DH/${unit}) — verifier`);
    }

    rows.push({ sourceRow, name, category, unit, unitCost, supplier, allergens });
  }

  return { rows, errors, warnings };
}

export interface IngredientExportRow {
  name: string;
  category: string | null;
  unit: string;
  unitCost: number | string;
  supplier: string | null;
  allergens: string[] | null;
  totalStock?: number | string | null;
  economat?: number | string | null;
  pesage?: number | string | null;
  activeLots?: number | string | null;
  nearestDlc?: string | null;
}

/**
 * Genere un workbook xlsx a partir d'une liste d'ingredients (avec stock optionnel).
 * Retourne un Buffer pret a etre envoye en HTTP response.
 */
export function generateIngredientWorkbook(items: IngredientExportRow[], opts: { includeStock?: boolean } = {}): Buffer {
  const includeStock = opts.includeStock !== false;

  const header = ['Nom', 'Categorie', 'Unite', 'Cout unitaire (DH)', 'Fournisseur', 'Allergenes'];
  if (includeStock) {
    header.push('Stock total', 'Economat', 'Pesage', 'Lots actifs', 'DLC plus proche');
  }

  const data: (string | number | null)[][] = [header];
  for (const item of items) {
    const allergens = Array.isArray(item.allergens) ? item.allergens.join(', ') : (item.allergens || '');
    const row: (string | number | null)[] = [
      item.name,
      item.category || 'autre',
      item.unit,
      typeof item.unitCost === 'number' ? item.unitCost : (parseFloat(String(item.unitCost || '0')) || 0),
      item.supplier || '',
      allergens,
    ];
    if (includeStock) {
      const toNum = (v: unknown) => {
        if (v === null || v === undefined || v === '') return 0;
        const n = typeof v === 'number' ? v : parseFloat(String(v));
        return Number.isFinite(n) ? n : 0;
      };
      row.push(
        toNum(item.totalStock),
        toNum(item.economat),
        toNum(item.pesage),
        toNum(item.activeLots),
        item.nearestDlc || '',
      );
    }
    data.push(row);
  }

  const sheet = XLSX.utils.aoa_to_sheet(data);
  // Largeurs lisibles
  const widths = [
    { wch: 30 }, { wch: 20 }, { wch: 8 }, { wch: 14 }, { wch: 22 }, { wch: 30 },
  ];
  if (includeStock) widths.push({ wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 11 }, { wch: 14 });
  sheet['!cols'] = widths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Ingredients');

  const out = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return out as Buffer;
}
