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
