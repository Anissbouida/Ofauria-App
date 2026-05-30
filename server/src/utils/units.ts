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
