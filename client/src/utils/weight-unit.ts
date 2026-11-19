/**
 * M3-04 — poids en quantité + unité saisie (g ou kg). La quantité s'affiche dans l'unité où
 * elle a été saisie (420 g reste 420 g) ; la conversion ne sert qu'aux calculs.
 */
export type WeightUnit = 'g' | 'kg';
export const WEIGHT_UNITS: WeightUnit[] = ['g', 'kg'];

const FACTOR: Record<WeightUnit, number> = { g: 1, kg: 1000 };

/** Conversion entre g et kg (arrondi à 1e-6). */
export function convertWeight(qty: number, from: WeightUnit, to: WeightUnit): number {
  return Math.round((qty * FACTOR[from]) / FACTOR[to] * 1e6) / 1e6;
}

export const asWeightUnit = (u: unknown, fallback: WeightUnit): WeightUnit => (u === 'g' || u === 'kg' ? u : fallback);

/**
 * Valeur lue du serveur : la quantité + unité saisie si elle existe, sinon l'ancienne
 * colonne dans l'unité de son nom.
 */
export function readWeight(qty: unknown, unit: unknown, legacy: unknown, legacyUnit: WeightUnit): { qty: number; unit: WeightUnit } | null {
  if (qty !== null && qty !== undefined && qty !== '') return { qty: Number(qty), unit: asWeightUnit(unit, legacyUnit) };
  if (legacy !== null && legacy !== undefined && legacy !== '') return { qty: Number(legacy), unit: legacyUnit };
  return null;
}

/** « 420 g », « 12,5 kg ». */
export const formatWeight = (w: { qty: number; unit: WeightUnit }) =>
  `${w.qty.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} ${w.unit}`;
