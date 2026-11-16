/**
 * G0-11 (plan d'action 2026-11) — contrôle du salaire minimum (SMIG).
 *
 * Compare la rémunération contractuelle du salarié au SMIG du barème en vigueur
 * à la date du bulletin (mig 524). Aucune valeur n'est codée : sans SMIG saisi
 * dans le barème, le contrôle ne dit rien.
 *
 *  - salarié payé à l'heure   : taux horaire contre le SMIG horaire ;
 *  - salarié au mois          : salaire mensuel contre le SMIG mensuel ;
 *  - salarié à la semaine     : salaire hebdomadaire ramené au mois (× 52 / 12)
 *                               contre le SMIG mensuel.
 * Le salaire comparé est le salaire à temps plein : un mois incomplet (absences)
 * ne déclenche pas d'alerte, c'est le contrat qui est contrôlé.
 */
export interface SmigScale { smigHourly: number | null; smigMonthly: number | null }
export interface SmigEmployee {
  monthly_salary?: unknown; weekly_salary?: unknown; hourly_rate?: unknown; pay_frequency?: string | null;
}
export interface SmigFinding { basis: 'horaire' | 'mensuel'; actual: number; minimum: number; gap: number; message: string }

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const dh = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function smigScaleFromRow(row: Record<string, unknown> | null | undefined): SmigScale {
  return { smigHourly: num(row?.smig_hourly), smigMonthly: num(row?.smig_monthly) };
}

/** Écart au SMIG, ou null si le salarié est conforme ou si rien n'est comparable. */
export function checkSmig(emp: SmigEmployee, scale: SmigScale): SmigFinding | null {
  const monthly = num(emp.monthly_salary);
  const weekly = num(emp.weekly_salary);
  const hourly = num(emp.hourly_rate);

  // Rémunération mensuelle de référence : le mois, sinon la semaine ramenée au mois.
  const asMonthly = emp.pay_frequency === 'weekly' && weekly ? r2(weekly * 52 / 12) : (monthly ?? (weekly ? r2(weekly * 52 / 12) : null));
  if (asMonthly !== null && scale.smigMonthly !== null) {
    if (asMonthly + 0.005 >= scale.smigMonthly) return null;
    const gap = r2(scale.smigMonthly - asMonthly);
    return { basis: 'mensuel', actual: asMonthly, minimum: scale.smigMonthly, gap,
      message: `Salaire de base ${dh(asMonthly)} DH sous le SMIG mensuel (${dh(scale.smigMonthly)} DH) : écart de ${dh(gap)} DH.` };
  }
  if (hourly !== null && scale.smigHourly !== null) {
    if (hourly + 0.00005 >= scale.smigHourly) return null;
    const gap = Math.round((scale.smigHourly - hourly) * 10000) / 10000;
    return { basis: 'horaire', actual: hourly, minimum: scale.smigHourly, gap,
      message: `Taux horaire ${dh(hourly)} DH sous le SMIG horaire (${dh(scale.smigHourly)} DH).` };
  }
  return null;
}

/**
 * Mode « bloquer » : message de refus de la génération si au moins un salarié est
 * sous le SMIG, sinon null.
 */
export function smigBlockMessage(employees: Array<SmigEmployee & { first_name?: unknown; last_name?: unknown }>, scale: SmigScale): string | null {
  const below = employees.filter(e => checkSmig(e, scale));
  if (!below.length) return null;
  return `Paie bloquée : ${below.length} salarié(s) sous le SMIG — `
    + below.map(e => `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim()).join(', ')
    + '. Corrigez le salaire de base ou passez le contrôle en avertissement (Paramètres de paie).';
}
