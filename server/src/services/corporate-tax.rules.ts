/**
 * Règles de calcul de l'IS (mig 430), sans accès à la base : taux
 * proportionnel unique selon le seuil (ou régime « crédit »), cotisation
 * minimale avec plancher, IS dû = max(IS, CM).
 */
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type TaxParams = {
  regime: 'standard' | 'credit'; rate_standard: number; rate_high: number; high_threshold: number; rate_credit: number;
  cm_rate: number; cm_minimum: number; cm_exempt: boolean; cm_base_override: number | null;
};
export const DEFAULTS: TaxParams = {
  regime: 'standard', rate_standard: 20, rate_high: 35, high_threshold: 100_000_000, rate_credit: 40,
  cm_rate: 0.25, cm_minimum: 3000, cm_exempt: false, cm_base_override: null,
};
export function rateFor(p: TaxParams, taxable: number) {
  return p.regime === 'credit' ? p.rate_credit : taxable >= p.high_threshold ? p.rate_high : p.rate_standard;
}
export function computeTax(p: TaxParams, taxable: number, cmBase: number) {
  const rate = rateFor(p, taxable);
  const is = taxable > 0 ? r2((taxable * rate) / 100) : 0;
  const cm = p.cm_exempt ? 0 : Math.max(r2((cmBase * p.cm_rate) / 100), p.cm_minimum);
  return { rate, is, cm, due: Math.max(is, cm) };
}
