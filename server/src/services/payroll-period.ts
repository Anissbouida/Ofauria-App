import { db } from '../config/database.js';

/**
 * G0-10 (plan d'action 2026-11) — la paie ne se génère que sur une période
 * TERMINÉE. Avant, on pouvait générer (et payer) le bulletin d'un mois en cours :
 * les jours non encore pointés y manquaient.
 *
 * Règle : refus si la fin de période est postérieure à la date du jour. Le
 * dernier jour de la période, la génération est permise. Un administrateur peut
 * déroger (`allowOpenPeriod`) : les bulletins sont alors marqués provisoires et
 * ne peuvent pas être payés.
 */
const PAYROLL_TZ = 'Africa/Casablanca';

/** Date du jour au Maroc, AAAA-MM-JJ. */
export function payrollToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PAYROLL_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export const frDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Dernier jour d'un mois, AAAA-MM-JJ. */
export function monthEnd(month: number, year: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export type PeriodDecision =
  | { ok: true; provisional: boolean }
  | { ok: false; status: number; message: string; availableFrom: string };

/**
 * Peut-on générer la paie de la période qui finit le `periodEnd` ?
 * `today` est injectable pour les tests.
 */
export function checkPayrollPeriod(periodEnd: string, opts: { allowOpenPeriod?: boolean; role?: string; label?: string; today?: string } = {}): PeriodDecision {
  const today = opts.today ?? payrollToday();
  if (periodEnd <= today) return { ok: true, provisional: false };
  const label = opts.label ?? 'La période';
  if (opts.allowOpenPeriod) {
    if (opts.role === 'admin') return { ok: true, provisional: true };
    return {
      ok: false, status: 403, availableFrom: periodEnd,
      message: `${label} n'est pas terminée : seul un administrateur peut générer une paie provisoire.`,
    };
  }
  return {
    ok: false, status: 409, availableFrom: periodEnd,
    message: `${label} n'est pas terminée (fin le ${frDate(periodEnd)}) : la paie pourra être générée à partir du ${frDate(periodEnd)}.`,
  };
}

const TABLES = { monthly: 'payroll', weekly: 'weekly_payroll', biweekly: 'biweekly_payroll' } as const;
export type PayrollKind = keyof typeof TABLES;

/** Marque provisoires (ou définitifs) les bulletins NON PAYÉS qui viennent d'être générés. */
export async function setProvisional(kind: PayrollKind, ids: string[], provisional: boolean): Promise<void> {
  if (!ids.length) return;
  await db.query(
    `UPDATE ${TABLES[kind]} SET is_provisional = $2 WHERE id = ANY($1::uuid[]) AND paid = false AND is_provisional IS DISTINCT FROM $2`,
    [ids, provisional]);
}

/** Message de refus si le bulletin est provisoire, sinon null. */
export async function provisionalRefusal(kind: PayrollKind, id: string): Promise<string | null> {
  const row = (await db.query(`SELECT is_provisional FROM ${TABLES[kind]} WHERE id = $1`, [id])).rows[0];
  return row?.is_provisional
    ? 'Bulletin provisoire (période non terminée) : régénérez la paie une fois la période finie avant de payer.'
    : null;
}
