/**
 * Réévaluation de clôture d'une créance ou d'une dette en devise (mig 431) —
 * règles pures, sans base (testables seules).
 *
 *   reste en DH au taux de clôture − reste en DH au taux de la facture = écart :
 *     dette (payable)       : écart > 0 → la dette augmente, perte latente → 3702
 *                             écart < 0 → la dette diminue, gain latent   → 4702
 *     créance (receivable)  : écart > 0 → la créance augmente, gain latent → 4701
 *                             écart < 0 → la créance diminue, perte latente → 3701
 */
export type FxSide = 'receivable' | 'payable';
export type FxAccount = '3701' | '3702' | '4701' | '4702';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function revalue(side: FxSide, foreignRemaining: number, bookAmount: number, closingRate: number) {
  const closingAmount = r2(foreignRemaining * closingRate);
  const difference = r2(closingAmount - bookAmount);
  const account: FxAccount | null = difference === 0 ? null
    : side === 'payable' ? (difference > 0 ? '3702' : '4702')
    : (difference > 0 ? '4701' : '3701');
  return { closingAmount, difference, account, latentLoss: account === '3701' || account === '3702' };
}

/** Compte de tiers et sens de l'ajustement : la créance (3421) suit l'écart, la dette (4411) aussi (au crédit). */
export function tiersLine(side: FxSide, difference: number) {
  const a = Math.abs(difference);
  if (side === 'receivable') return { code: '3421', debit: difference > 0 ? a : 0, credit: difference < 0 ? a : 0 };
  return { code: '4411', debit: difference < 0 ? a : 0, credit: difference > 0 ? a : 0 };
}
