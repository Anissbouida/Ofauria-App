/**
 * Calcul d'une situation de travaux (facturation à l'avancement, mig 713).
 * Le même calcul sert à l'aperçu de l'écran et à l'enregistrement par le serveur.
 *
 *   cumul de la ligne    = montant du marché × % cumulé
 *   période              = cumul − cumul de la situation validée précédente
 *   retenue de garantie  = période × taux de retenue
 *   remboursement avance = période × taux de remboursement, borné au reste de l'avance
 *   net HT               = période − retenue − remboursement
 *   TVA                  = au taux de chaque ligne, sur sa part du net
 */
export interface ProgressLineInput {
  contractAmount: number;
  tvaRate: number;
  pctCumulative: number;
  /** Cumul facturé à la situation validée précédente (0 pour la première). */
  previousCumulative: number;
}

export interface ProgressSettings {
  retentionPct: number;
  advanceAmount: number;
  advanceRecoveryPct: number;
  /** Avance déjà remboursée par les situations validées précédentes. */
  advanceRecoveredBefore: number;
}

export interface ProgressLineResult { amountCumulative: number; amountPrevious: number; amountPeriod: number }

export interface ProgressResult {
  lines: ProgressLineResult[];
  contractHt: number; cumulativeHt: number; previousHt: number; periodHt: number;
  retentionAmount: number; advanceRecoveryAmount: number; netHt: number; taxAmount: number; totalTtc: number;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeProgressBilling(lines: ProgressLineInput[], s: ProgressSettings): ProgressResult {
  const out = lines.map(l => {
    const pct = Math.min(100, Math.max(0, Number(l.pctCumulative) || 0));
    const amountCumulative = r2(Number(l.contractAmount) * pct / 100);
    const amountPrevious = r2(Number(l.previousCumulative) || 0);
    return { amountCumulative, amountPrevious, amountPeriod: r2(amountCumulative - amountPrevious) };
  });
  const sum = (f: (x: ProgressLineResult, i: number) => number) => r2(out.reduce((a, x, i) => a + f(x, i), 0));
  const contractHt = r2(lines.reduce((a, l) => a + Number(l.contractAmount), 0));
  const cumulativeHt = sum(x => x.amountCumulative);
  const previousHt = sum(x => x.amountPrevious);
  const periodHt = sum(x => x.amountPeriod);
  const retentionAmount = r2(periodHt * (Number(s.retentionPct) || 0) / 100);
  const advanceLeft = Math.max(0, r2((Number(s.advanceAmount) || 0) - (Number(s.advanceRecoveredBefore) || 0)));
  const advanceRecoveryAmount = periodHt > 0 ? Math.min(advanceLeft, r2(periodHt * (Number(s.advanceRecoveryPct) || 0) / 100)) : 0;
  const netHt = r2(periodHt - retentionAmount - advanceRecoveryAmount);
  const share = periodHt !== 0 ? netHt / periodHt : 0;
  const taxAmount = sum((x, i) => x.amountPeriod * share * (Number(lines[i].tvaRate) || 0) / 100);
  return { lines: out, contractHt, cumulativeHt, previousHt, periodHt, retentionAmount, advanceRecoveryAmount, netHt, taxAmount, totalTtc: r2(netHt + taxAmount) };
}

/** Un % cumulé ne recule pas sous celui de la situation validée précédente. */
export function progressRegressions(lines: { label: string; pctCumulative: number; previousPct: number }[]): string[] {
  return lines.filter(l => Number(l.pctCumulative) + 1e-9 < Number(l.previousPct)).map(l => l.label);
}

/**
 * Prix d'une prestation de transport selon une grille par tranches (mig 714).
 * La tranche qui contient la quantité (première borne haute ≥ quantité, ou la tranche ouverte)
 * donne le prix unitaire et le forfait ; le minimum de facturation s'applique en dernier.
 */
export interface FreightBracket { upTo: number | null; unitPrice: number; flatPrice: number }

export function computeFreightPrice(brackets: FreightBracket[], quantity: number, minimumCharge = 0):
  { bracket: FreightBracket | null; amount: number; minimumApplied: boolean } {
  const q = Number(quantity) || 0;
  const sorted = [...brackets].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
  const bracket = sorted.find(b => b.upTo === null || q <= b.upTo) ?? null;
  const raw = bracket ? r2(q * Number(bracket.unitPrice) + Number(bracket.flatPrice)) : 0;
  const min = Number(minimumCharge) || 0;
  return { bracket, amount: Math.max(raw, min), minimumApplied: min > raw };
}
