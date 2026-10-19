/**
 * Heures supplementaires et jours feries — fonctions PURES (lot 3, mig 321).
 *
 * Code du travail art. 196-204 : majoration de 25 % (6h-21h) ou 50 %
 * (21h-6h) un jour ouvrable ; 50 % / 100 % le jour de repos hebdomadaire.
 * Jours feries : non travaille = jour paye ; travaille = indemnite en plus.
 */

export interface OvertimeRates { day: number; night: number; restDay: number; restNight: number }
export interface OvertimeHours { day: number; night: number; restDay: number; restNight: number }

export const DEFAULT_OT_RATES: OvertimeRates = { day: 0.25, night: 0.5, restDay: 0.5, restNight: 1 };

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const toMin = (t: string) => { const [h, m] = t.slice(0, 5).split(':').map(Number); return h * 60 + m; };

/**
 * Minutes travaillees de nuit entre l'arrivee et le depart (depart <= arrivee =
 * service qui passe minuit). Fenetre de nuit [nightStart, nightEnd[ a cheval sur minuit.
 */
export function nightMinutes(checkIn: string, checkOut: string, nightStart = '21:00', nightEnd = '06:00'): number {
  const a = toMin(checkIn);
  let b = toMin(checkOut);
  if (b <= a) b += 1440;
  const ns = toMin(nightStart);
  const ne = toMin(nightEnd);
  // Fenetres de nuit sur deux jours : [ne-1440... ] -> on enumere les intervalles utiles.
  const windows: Array<[number, number]> = ns > ne
    ? [[ns - 1440, ne], [ns, ne + 1440], [ns + 1440, ne + 2880]]
    : [[ns, ne], [ns + 1440, ne + 1440]];
  let total = 0;
  for (const [ws, we] of windows) total += Math.max(0, Math.min(b, we) - Math.max(a, ws));
  return total;
}

/**
 * Part de nuit des heures supplementaires d'une journee : les heures sup sont
 * en fin de service, donc on prend d'abord la nuit travaillee, plafonnee au
 * total d'heures sup.
 */
export function nightOvertimeMinutes(overtimeMinutes: number, checkIn?: string | null, checkOut?: string | null, nightStart?: string, nightEnd?: string): number {
  if (!overtimeMinutes || !checkIn || !checkOut) return 0;
  return Math.min(overtimeMinutes, nightMinutes(checkIn, checkOut, nightStart, nightEnd));
}

export interface AttendanceOtRow { date: string; overtimeMinutes: number; overtimeNightMinutes: number; isRestDay: boolean | null }

/** Ventile les heures sup d'une periode en 4 categories (heures). */
export function classifyOvertime(rows: AttendanceOtRow[], restWeekday: number): OvertimeHours {
  const out = { day: 0, night: 0, restDay: 0, restNight: 0 };
  for (const r of rows) {
    const total = Math.max(0, r.overtimeMinutes || 0);
    if (!total) continue;
    const night = Math.min(total, Math.max(0, r.overtimeNightMinutes || 0));
    const rest = r.isRestDay ?? new Date(`${r.date.slice(0, 10)}T00:00:00Z`).getUTCDay() === restWeekday;
    if (rest) { out.restDay += (total - night) / 60; out.restNight += night / 60; }
    else { out.day += (total - night) / 60; out.night += night / 60; }
  }
  return { day: r2(out.day), night: r2(out.night), restDay: r2(out.restDay), restNight: r2(out.restNight) };
}

/** Montant des heures sup : taux horaire x heures x (1 + majoration), par categorie. */
export function overtimeAmount(hours: OvertimeHours, hourlyRate: number, rates: OvertimeRates = DEFAULT_OT_RATES): number {
  return r2(hourlyRate * (
    hours.day * (1 + rates.day) + hours.night * (1 + rates.night)
    + hours.restDay * (1 + rates.restDay) + hours.restNight * (1 + rates.restNight)
  ));
}

export const totalHours = (h: OvertimeHours) => r2(h.day + h.night + h.restDay + h.restNight);

const WORKED = new Set(['present', 'late', 'double', 'half_day']);

/**
 * Jours feries d'une periode pour un employe :
 *  - travailles (pointage reel present/retard/double/demi) -> indemnite ;
 *  - non travailles -> jours payes (couverts), sauf s'ils tombent le jour de
 *    repos hebdomadaire ou avant l'embauche.
 */
export function holidayDays(
  holidays: string[], from: string, to: string,
  attendance: Map<string, string>, opts: { restWeekday: number; hireDate?: string | null },
): { paid: number; worked: number } {
  let paid = 0;
  let worked = 0;
  for (const h of holidays) {
    if (h < from || h > to) continue;
    if (opts.hireDate && h < opts.hireDate.slice(0, 10)) continue;
    const status = attendance.get(h);
    if (status && WORKED.has(status)) { worked += status === 'half_day' ? 0.5 : 1; continue; }
    if (new Date(`${h}T00:00:00Z`).getUTCDay() === opts.restWeekday) continue;
    paid += 1;
  }
  return { paid, worked };
}
