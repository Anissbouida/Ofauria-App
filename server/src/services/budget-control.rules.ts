/**
 * Contrôle budgétaire (lot Bonus 15, mig 435), sans accès à la base.
 *
 * Disponible d'un compte = budget − réel − engagé, sur la période de contrôle :
 *   - « annual » : budget de l'année entière contre le réel de l'année ;
 *   - « cumulative » : budget cumulé jusqu'au mois de la pièce contre le réel
 *     cumulé sur les mêmes mois.
 * L'engagé (BC envoyés ni reçus ni facturés) compte en entier : c'est une
 * dépense promise, quelle que soit sa date de réception.
 * Seuls les comptes présents au budget sont contrôlés ; une demande qui
 * dépasse le disponible déclenche l'action du budget (alerte ou blocage).
 */
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type ControlAction = 'none' | 'warn' | 'block';
export type ControlPeriod = 'annual' | 'cumulative';

export type AccountPosition = {
  account_id: string; code: string; label: string;
  budget: number[]; actual: number[]; committed: number;
};
export type ControlLine = {
  account_id: string; code: string; label: string;
  budget: number; actual: number; committed: number; available: number; request: number; exceeded: number;
};

export function availability(p: AccountPosition, period: ControlPeriod, month: number) {
  const n = period === 'annual' ? 12 : Math.min(12, Math.max(1, month));
  const budget = r2(p.budget.slice(0, n).reduce((s, v) => s + v, 0));
  const actual = r2(p.actual.slice(0, n).reduce((s, v) => s + v, 0));
  return { budget, actual, committed: r2(p.committed), available: r2(budget - actual - p.committed) };
}

/**
 * Verdict d'une demande (montants HT par compte) : `ok`, ou l'action du
 * budget si au moins un compte budgété est dépassé.
 */
export function controlRequest(p: {
  action: ControlAction; period: ControlPeriod; month: number;
  positions: AccountPosition[]; request: Map<string, number>;
}): { outcome: 'ok' | 'warn' | 'block'; lines: ControlLine[] } {
  const lines: ControlLine[] = [];
  for (const pos of p.positions) {
    const request = r2(p.request.get(pos.account_id) ?? 0);
    if (request <= 0) continue;
    const a = availability(pos, p.period, p.month);
    lines.push({ account_id: pos.account_id, code: pos.code, label: pos.label, ...a, request, exceeded: r2(Math.max(0, request - Math.max(0, a.available))) });
  }
  const over = lines.some(l => l.exceeded > 0);
  return { outcome: over && p.action !== 'none' ? p.action : 'ok', lines };
}
