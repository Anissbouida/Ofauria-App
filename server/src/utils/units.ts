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

/**
 * Convertit une quantite vers l'unite de base.
 * Si les unites ne sont pas dans le meme systeme (ex: g -> l), retourne la valeur
 * AS-IS (l'appelant doit alors verifier que les unites matchent en amont).
 */
export function toBaseUnit(quantity: number, fromUnit: string | null, baseUnit: string | null): number {
  if (!fromUnit || !baseUnit || fromUnit === baseUnit) return quantity;
  const factor = FACTORS[fromUnit]?.[baseUnit];
  if (factor === undefined) {
    // Unites incompatibles (ex: pcs -> kg). On ne peut pas convertir, on laisse tel quel.
    return quantity;
  }
  return quantity * factor;
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
