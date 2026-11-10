// Conversions d'unites pour les ingredients/recettes.
//
// Contexte : un ingredient est stocke avec une unite de BASE (kg pour les
// solides, l pour les liquides). Les recettes peuvent specifier les besoins
// dans une unite differente (g, ml) pour ne pas mettre 0.420 partout.
//
// Le besoin doit etre stocke dans la base unit pour permettre :
//   - aggregation entre plusieurs recettes (sommes correctes)
//   - comparaison avec les lots (qui sont en kg/l)
//   - SQL SUM() sans surprise
//
// Le display peut ensuite re-convertir intelligemment (cf smartFormat).

const SAME = 1;
const K = 1000;
const MILLI = 0.001;
const CENTI = 0.01;
const HECTO = 100;

const FACTORS: Record<string, Record<string, number>> = {
  // de -> { vers -> facteur }
  g:  { g: SAME, kg: MILLI },
  kg: { kg: SAME, g: K },
  ml: { ml: SAME, l: MILLI, cl: 0.1 },
  cl: { cl: SAME, l: CENTI, ml: 10 },
  l:  { l: SAME, ml: K, cl: HECTO },
  // unites "comptables" (pcs, paq...) : pas de conversion possible
};

const MASS_UNITS = new Set(['mg', 'g', 'kg']);
const VOLUME_UNITS = new Set(['ml', 'cl', 'dl', 'l']);

/** True si la conversion traverse poids <-> volume (necessite une densite). */
export function isCrossTypeConversion(fromUnit: string | null, toUnit: string | null): boolean {
  if (!fromUnit || !toUnit) return false;
  const f = fromUnit.toLowerCase();
  const t = toUnit.toLowerCase();
  return (MASS_UNITS.has(f) && VOLUME_UNITS.has(t)) || (VOLUME_UNITS.has(f) && MASS_UNITS.has(t));
}

/**
 * Convertit une quantite vers l'unite de base, avec support poids <-> volume via
 * la masse volumique (densiteKgL, en kg/L == g/ml). Miroir de fn_unit_conv 3 args
 * (migration 227). Les chefs pesent les liquides ("1.2 kg de lait") alors que le
 * stock est en litres : sans densite, ce cas etait silencieusement ignore.
 *
 * `uncertain` = true quand une conversion poids<->volume etait necessaire mais la
 * densite est absente : la valeur est retournee AS-IS et l'appelant doit avertir.
 */
export function convertQuantity(
  quantity: number,
  fromUnit: string | null,
  baseUnit: string | null,
  densiteKgL?: number | null
): { value: number; uncertain: boolean } {
  if (!fromUnit || !baseUnit || fromUnit === baseUnit) return { value: quantity, uncertain: false };
  const from = fromUnit.toLowerCase();
  const to = baseUnit.toLowerCase();

  const factor = FACTORS[from]?.[to];
  if (factor !== undefined) return { value: quantity * factor, uncertain: false };

  if (isCrossTypeConversion(from, to)) {
    if (densiteKgL && densiteKgL > 0) {
      if (MASS_UNITS.has(from)) {
        // Poids -> volume : grammes / densite(g/ml) = ml
        const grams = quantity * (FACTORS[from]?.['g'] ?? (from === 'g' ? 1 : NaN));
        const ml = grams / densiteKgL;
        const volFactor = FACTORS['ml']?.[to] ?? (to === 'ml' ? 1 : NaN);
        if (!Number.isNaN(grams) && !Number.isNaN(volFactor)) return { value: ml * volFactor, uncertain: false };
      } else {
        // Volume -> poids : ml * densite(g/ml) = grammes
        const ml = quantity * (FACTORS[from]?.['ml'] ?? (from === 'ml' ? 1 : NaN));
        const grams = ml * densiteKgL;
        const massFactor = FACTORS['g']?.[to] ?? (to === 'g' ? 1 : NaN);
        if (!Number.isNaN(ml) && !Number.isNaN(massFactor)) return { value: grams * massFactor, uncertain: false };
      }
    }
    // Densite absente : valeur AS-IS, mais on le signale.
    return { value: quantity, uncertain: true };
  }

  // Unites incompatibles hors poids/volume (ex: pcs -> kg) : comportement historique.
  return { value: quantity, uncertain: false };
}

/**
 * Convertit une quantite vers l'unite de base.
 * Si les unites ne sont pas dans le meme systeme (ex: g -> l), retourne la valeur
 * AS-IS sauf si une densite est fournie (cf convertQuantity).
 */
export function toBaseUnit(quantity: number, fromUnit: string | null, baseUnit: string | null, densiteKgL?: number | null): number {
  return convertQuantity(quantity, fromUnit, baseUnit, densiteKgL).value;
}

/**
 * Format intelligent pour l'affichage : si la valeur en base est < 1 (kg ou l),
 * convertit en sous-unite (g ou ml) pour eviter "0.42 kg" et afficher "420 g".
 * Pour les unites non base-1000 (pcs, paq), retourne tel quel.
 */
export function smartFormat(quantityInBase: number, baseUnit: string | null): { value: number; unit: string } {
  if (!baseUnit) return { value: quantityInBase, unit: '' };
  if (baseUnit === 'kg' && quantityInBase > 0 && quantityInBase < 1) {
    return { value: quantityInBase * K, unit: 'g' };
  }
  if (baseUnit === 'l' && quantityInBase > 0 && quantityInBase < 1) {
    return { value: quantityInBase * K, unit: 'ml' };
  }
  return { value: quantityInBase, unit: baseUnit };
}

// products.sale_unit n'a que 2 valeurs (contrainte SQL mig 128) :
//   'unit'   -> vendu a la piece
//   'weight' -> vendu au kg
export type SellingUnit = 'unit' | 'weight';

export class YieldConversionError extends Error {
  readonly yieldUnit: string;
  readonly sellingUnit: SellingUnit;
  readonly needsPieceWeight: boolean;
  constructor(yieldUnit: string, sellingUnit: SellingUnit, needsPieceWeight: boolean) {
    const target = sellingUnit === 'weight' ? 'kg' : 'piece';
    const tail = needsPieceWeight
      ? ' — renseigne le poids unitaire (piece_weight_kg) sur la recette.'
      : ' — combinaison non supportee.';
    super(`Impossible de convertir un rendement en "${yieldUnit}" vers une vente "${target}"${tail}`);
    this.name = 'YieldConversionError';
    this.yieldUnit = yieldUnit;
    this.sellingUnit = sellingUnit;
    this.needsPieceWeight = needsPieceWeight;
  }
}

/**
 * Convertit un rendement de recette (exprime en yieldUnit) vers son equivalent
 * dans l'unite de vente du produit lie (products.sale_unit).
 *
 * Utilisation : recipe.repository.ts syncProductPrice() pour calculer le
 * cout/prix unitaire dans la BONNE unite (DH/kg si vente au poids, DH/piece
 * si vente a la piece).
 *
 * Regles :
 *   yield_unit    sale_unit       resultat
 *   kg            weight (kg)     yieldQty                  (identite)
 *   g             weight (kg)     yieldQty / 1000
 *   unit          weight (kg)     yieldQty * pieceWeightKg  (requis)
 *   unit          unit            yieldQty                  (identite)
 *   kg            unit            yieldQty / pieceWeightKg  (requis)
 *   g             unit            (yieldQty/1000) / pieceWeightKg
 *   l, ml, moule, plaque, batch   -> YieldConversionError
 *
 * @throws YieldConversionError si la conversion est impossible (combinaison non geree
 *         ou pieceWeightKg manquant alors qu'il est requis).
 */
export function yieldInSellingUnit(
  yieldQty: number,
  yieldUnit: string,
  sellingUnit: SellingUnit,
  pieceWeightKg: number | null,
): number {
  if (yieldQty <= 0) return 0;
  const norm = (yieldUnit || 'unit').toLowerCase();
  const hasPieceWeight = pieceWeightKg !== null && pieceWeightKg > 0;

  if (sellingUnit === 'weight') {
    if (norm === 'kg') return yieldQty;
    if (norm === 'g')  return yieldQty / K;
    if (norm === 'unit') {
      if (!hasPieceWeight) throw new YieldConversionError(yieldUnit, sellingUnit, true);
      return yieldQty * (pieceWeightKg as number);
    }
    throw new YieldConversionError(yieldUnit, sellingUnit, false);
  }

  // sellingUnit === 'unit'
  if (norm === 'unit') return yieldQty;
  if (norm === 'kg') {
    if (!hasPieceWeight) throw new YieldConversionError(yieldUnit, sellingUnit, true);
    return yieldQty / (pieceWeightKg as number);
  }
  if (norm === 'g') {
    if (!hasPieceWeight) throw new YieldConversionError(yieldUnit, sellingUnit, true);
    return (yieldQty / K) / (pieceWeightKg as number);
  }
  throw new YieldConversionError(yieldUnit, sellingUnit, false);
}

/**
 * True si pieceWeightKg est obligatoire pour convertir yieldUnit vers sellingUnit.
 * Sert au garde-fou de validation a la creation/edition de recette.
 */
export function requiresPieceWeight(yieldUnit: string, sellingUnit: SellingUnit): boolean {
  const norm = (yieldUnit || 'unit').toLowerCase();
  if (sellingUnit === 'weight') return norm === 'unit';
  return norm === 'kg' || norm === 'g';
}

// ─── Conversions pilotées par le référentiel (phase 3.3, mig 470) ───────────
//
// Généralisation multi-secteur de la table FACTORS codée en dur ci-dessus : les
// facteurs ne vivent plus dans le code mais dans le référentiel des unités
// (ref_entries table_id='units', metadata { category, to_base, is_base }).
// Un admin peut donc ajouter une unité (ex. « sachet », « boîte ») avec sa
// famille et son facteur, sans toucher au code.
//
// Base par famille : to_base exprime 1 unité dans l'unité de base de sa famille
// (g pour mass, ml pour volume, unit pour count). Conversion A→B même famille :
//   valeur_B = valeur_A × (to_base_A / to_base_B).
// Les passages inter-familles (poids↔volume) restent du ressort de la densité
// par ingrédient (convertQuantity ci-dessus) : ici on les signale `uncertain`.

export interface UnitRegistryEntry {
  /** Famille de mesure : 'mass' | 'volume' | 'count' (ou toute famille future). */
  category: string;
  /** Facteur pour exprimer 1 unité dans l'unité de base de la famille. */
  toBase: number;
}

export type UnitRegistry = Map<string, UnitRegistryEntry>;

/** Forme minimale d'une entrée de référentiel `units` consommée ici. */
interface RawUnitEntry {
  code?: string | null;
  metadata?: { category?: unknown; to_base?: unknown; is_base?: unknown } | null;
}

/**
 * Construit le registre de conversion depuis les entrées du référentiel `units`.
 * Ignore les entrées sans code, sans famille ou sans facteur positif (une unité
 * « comptable » laissée sans metadata n'est simplement pas convertible).
 */
export function buildUnitRegistry(entries: RawUnitEntry[]): UnitRegistry {
  const reg: UnitRegistry = new Map();
  for (const e of entries || []) {
    const code = (e.code || '').toString().trim().toLowerCase();
    const md = e.metadata || {};
    const category = typeof md.category === 'string' ? md.category : '';
    const toBase = Number(md.to_base);
    if (!code || !category || !Number.isFinite(toBase) || toBase <= 0) continue;
    reg.set(code, { category, toBase });
  }
  return reg;
}

/**
 * Convertit une quantité d'une unité vers une autre à l'aide du registre.
 * `uncertain=true` quand la conversion n'est pas déterministe à partir du seul
 * référentiel : unité inconnue, ou familles différentes (densité requise).
 * Dans ce cas la valeur est renvoyée AS-IS et l'appelant doit avertir/fallback.
 */
export function convertByRegistry(
  value: number,
  fromUnit: string | null,
  toUnit: string | null,
  registry: UnitRegistry,
): { value: number; uncertain: boolean } {
  if (!fromUnit || !toUnit) return { value, uncertain: false };
  const from = fromUnit.trim().toLowerCase();
  const to = toUnit.trim().toLowerCase();
  if (from === to) return { value, uncertain: false };
  const a = registry.get(from);
  const b = registry.get(to);
  if (!a || !b) return { value, uncertain: true };
  if (a.category !== b.category) return { value, uncertain: true };
  return { value: value * (a.toBase / b.toBase), uncertain: false };
}
