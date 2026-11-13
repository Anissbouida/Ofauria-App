/**
 * Quantités décimales (mig 512) : les quantités de production circulent en nombres
 * flottants (DOUBLE PRECISION). On les arrondit au millième à chaque calcul pour ne
 * pas laisser traîner 9.299999999 (12,5 − 3,2) jusqu'en base ou à l'écran.
 */
export const roundQty = (n: number): number => Math.round((Number(n) || 0) * 1000) / 1000;
