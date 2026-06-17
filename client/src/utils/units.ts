// Affichage intelligent des quantites stockees en unite de base (kg, l).
// Si la valeur est < 1 dans une unite base-1000, on convertit en sous-unite
// pour eviter "0.42 kg" et afficher "420 g".

const K = 1000;

export function smartFormatQuantity(quantityInBase: number, baseUnit: string | null | undefined): { value: number; unit: string } {
  if (!baseUnit) return { value: quantityInBase, unit: '' };
  if (baseUnit === 'kg' && quantityInBase > 0 && quantityInBase < 1) {
    return { value: quantityInBase * K, unit: 'g' };
  }
  if (baseUnit === 'l' && quantityInBase > 0 && quantityInBase < 1) {
    return { value: quantityInBase * K, unit: 'ml' };
  }
  return { value: quantityInBase, unit: baseUnit };
}

/** Helper compact pour afficher "420 g" ou "1.05 kg" en un seul appel. */
export function formatQty(quantityInBase: number, baseUnit: string | null | undefined, fractionDigits = 2): string {
  const { value, unit } = smartFormatQuantity(quantityInBase, baseUnit);
  // Pour g/ml on tronque la decimale (un gramme c'est deja precis).
  const digits = unit === 'g' || unit === 'ml' ? 0 : fractionDigits;
  return `${value.toFixed(digits)} ${unit}`.trim();
}

// ===========================================================================
// Conversion du rendement vers l'unite de vente d'un produit.
// Miroir de server/src/utils/units.ts (yieldInSellingUnit). Garder les deux
// fonctions synchrones si la logique change.
// ===========================================================================

export type SellingUnit = 'unit' | 'weight';

export type YieldConversionResult =
  | { ok: true; value: number }
  | { ok: false; reason: 'piece_weight_required' | 'unsupported_combination'; message: string };

/**
 * Convertit yieldQty (en yieldUnit) vers son equivalent dans sellingUnit.
 * Renvoie un resultat tagged : pas d'exception cote UI, le composant choisit
 * comment afficher l'erreur (champ desactive, message inline...).
 */
export function yieldInSellingUnit(
  yieldQty: number,
  yieldUnit: string,
  sellingUnit: SellingUnit,
  pieceWeightKg: number | null,
): YieldConversionResult {
  if (yieldQty <= 0) return { ok: true, value: 0 };
  const norm = (yieldUnit || 'unit').toLowerCase();
  const hasPieceWeight = pieceWeightKg !== null && pieceWeightKg > 0;

  const target = sellingUnit === 'weight' ? 'kg' : 'piece';
  const needsPieceWeight = () => ({
    ok: false as const,
    reason: 'piece_weight_required' as const,
    message: `Le rendement est en "${yieldUnit}" mais le produit est vendu ${target === 'kg' ? 'au kg' : 'a la piece'}. Renseigne le poids unitaire d'une piece.`,
  });
  const unsupported = () => ({
    ok: false as const,
    reason: 'unsupported_combination' as const,
    message: `Impossible de convertir un rendement en "${yieldUnit}" vers une vente ${target === 'kg' ? 'au kg' : 'a la piece'}.`,
  });

  if (sellingUnit === 'weight') {
    if (norm === 'kg') return { ok: true, value: yieldQty };
    if (norm === 'g')  return { ok: true, value: yieldQty / 1000 };
    if (norm === 'unit') {
      if (!hasPieceWeight) return needsPieceWeight();
      return { ok: true, value: yieldQty * (pieceWeightKg as number) };
    }
    return unsupported();
  }

  // sellingUnit === 'unit'
  if (norm === 'unit') return { ok: true, value: yieldQty };
  if (norm === 'kg') {
    if (!hasPieceWeight) return needsPieceWeight();
    return { ok: true, value: yieldQty / (pieceWeightKg as number) };
  }
  if (norm === 'g') {
    if (!hasPieceWeight) return needsPieceWeight();
    return { ok: true, value: (yieldQty / 1000) / (pieceWeightKg as number) };
  }
  return unsupported();
}

/** True si pieceWeightKg est requis pour convertir yieldUnit vers sellingUnit. */
export function requiresPieceWeight(yieldUnit: string, sellingUnit: SellingUnit): boolean {
  const norm = (yieldUnit || 'unit').toLowerCase();
  if (sellingUnit === 'weight') return norm === 'unit';
  return norm === 'kg' || norm === 'g';
}
