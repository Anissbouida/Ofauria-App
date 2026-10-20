/**
 * Solde de tout compte — fonctions PURES (lot 6, mig 323).
 *
 * Code du travail et decret n° 2-04-469 :
 *  - preavis (decret) : cadre 1 / 2 / 3 mois ; employe et ouvrier 8 jours /
 *    1 mois / 2 mois, selon l'anciennete (< 1 an, 1 a 5 ans, > 5 ans) ;
 *  - indemnite de licenciement (art. 52-53) : des 6 mois de service, hors faute
 *    grave ; 96 h de salaire par annee jusqu'a 5 ans, 144 h de 6 a 10, 192 h de
 *    11 a 15, 240 h au-dela ; fraction d'annee au prorata ; base = salaire
 *    moyen (52 dernieres semaines) / 191 h ;
 *  - dommages-interets (art. 41) : 1,5 mois de salaire par annee, plafond
 *    36 mois, sur decision (licenciement abusif) ;
 *  - conges : indemnite compensatrice des jours acquis non pris.
 */

export type ExitReason =
  | 'demission' | 'licenciement' | 'faute_grave' | 'fin_cdd' | 'rupture_essai'
  | 'depart_negocie' | 'retraite' | 'deces' | 'abandon_poste';

export const EXIT_REASON_LABELS: Record<ExitReason, string> = {
  demission: 'Démission', licenciement: 'Licenciement', faute_grave: 'Licenciement pour faute grave',
  fin_cdd: 'Fin de contrat à durée déterminée', rupture_essai: 'Rupture de la période d\'essai',
  depart_negocie: 'Départ négocié', retraite: 'Départ à la retraite', deces: 'Décès', abandon_poste: 'Abandon de poste',
};

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
/** Nombre au format francais pour les libelles (7,5 ; 1 538,46). */
const f = (v: number) => r2(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 }).replace(/[\u202F\u00A0]/g, ' ');

/** Anciennete en annees decimales (jours / 365,25), et annees + mois pour l'affichage. */
export function seniority(start: string, end: string): { years: number; label: string } {
  const [sy, sm, sd] = start.slice(0, 10).split('-').map(Number);
  const [ey, em, ed] = end.slice(0, 10).split('-').map(Number);
  let months = (ey - sy) * 12 + (em - sm);
  if (ed < sd) months--;
  months = Math.max(0, months);
  const days = (Date.parse(`${end.slice(0, 10)}T00:00:00Z`) - Date.parse(`${start.slice(0, 10)}T00:00:00Z`)) / 86400000 + 1;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return { years: Math.max(0, days / 365.25), label: `${y} an${y > 1 ? 's' : ''}${m ? ` ${m} mois` : ''}` };
}

/** Duree legale du preavis (decret n° 2-04-469). */
export function noticePeriod(category: 'cadre' | 'employe' | 'ouvrier', years: number): { months: number; days: number; label: string } {
  if (category === 'cadre') {
    const months = years < 1 ? 1 : years <= 5 ? 2 : 3;
    return { months, days: 0, label: `${months} mois` };
  }
  if (years < 1) return { months: 0, days: 8, label: '8 jours' };
  const months = years <= 5 ? 1 : 2;
  return { months, days: 0, label: `${months} mois` };
}

/** Heures d'indemnite de licenciement (art. 53), tranche par tranche. */
export function severanceHours(years: number): number {
  const bands: Array<[number, number]> = [[5, 96], [10, 144], [15, 192], [Infinity, 240]];
  let hours = 0;
  let from = 0;
  for (const [to, h] of bands) {
    if (years <= from) break;
    hours += (Math.min(years, to) - from) * h;
    from = to;
  }
  return hours;
}

export interface SettlementInput {
  reason: ExitReason;
  contractType: string;               // cdi, cdd...
  category: 'cadre' | 'employe' | 'ouvrier';
  hireDate: string;
  exitDate: string;
  monthlySalary: number;              // salaire de base actuel
  averageMonthlyGross: number;        // salaire moyen de reference (12 derniers mois)
  legalMonthlyHours?: number;         // 191
  baseDays?: number;                  // 26
  leaveBalanceDays: number;           // solde de conges a la date de sortie (peut etre negatif)
  noticeWorked: boolean;              // preavis effectue ?
  damagesMonths?: number;             // dommages-interets accordes (mois), 0 par defaut
}

export interface SettlementLine { code: string; label: string; amount: number; kind: 'gain' | 'retenue'; detail: string }

export interface SettlementResult {
  seniorityYears: number;
  seniorityLabel: string;
  referenceSalary: number;
  hourlyRate: number;
  dailyRate: number;
  notice: { months: number; days: number; label: string; due: boolean; amount: number; owedByEmployee: boolean };
  severance: { eligible: boolean; hours: number; amount: number; reason: string };
  leave: { days: number; amount: number };
  damages: { months: number; amount: number };
  lines: SettlementLine[];
  totalGains: number;
  totalDeductions: number;
}

export function computeSettlement(i: SettlementInput): SettlementResult {
  const sen = seniority(i.hireDate, i.exitDate);
  const ref = i.averageMonthlyGross > 0 ? i.averageMonthlyGross : i.monthlySalary;
  const hourly = ref / (i.legalMonthlyHours ?? 191);
  const daily = i.monthlySalary / (i.baseDays ?? 26);
  const lines: SettlementLine[] = [];

  // ─── Conges acquis non pris (ou pris par anticipation) ───
  const leaveAmount = r2(Math.abs(i.leaveBalanceDays) * daily);
  if (i.leaveBalanceDays > 0.004) {
    lines.push({ code: 'IND_CONGES', label: 'Indemnité compensatrice de congés payés', amount: leaveAmount, kind: 'gain', detail: `${f(i.leaveBalanceDays)} j × ${f(daily)} DH` });
  } else if (i.leaveBalanceDays < -0.004) {
    lines.push({ code: 'RET_CONGES', label: 'Congés pris par anticipation', amount: leaveAmount, kind: 'retenue', detail: `${f(-i.leaveBalanceDays)} j × ${f(daily)} DH` });
  }

  // ─── Preavis : du par l'employeur s'il dispense le salarie (licenciement hors
  // faute grave), du par le salarie demissionnaire qui ne l'effectue pas. ───
  const notice = noticePeriod(i.category, sen.years);
  const noticeValue = r2(notice.months * i.monthlySalary + notice.days * daily);
  const employerOwes = !i.noticeWorked && ['licenciement', 'depart_negocie'].includes(i.reason);
  const employeeOwes = !i.noticeWorked && i.reason === 'demission';
  if (employerOwes) lines.push({ code: 'IND_PREAVIS', label: 'Indemnité compensatrice de préavis', amount: noticeValue, kind: 'gain', detail: `${notice.label} non effectué(s)` });
  if (employeeOwes) lines.push({ code: 'RET_PREAVIS', label: 'Préavis non respecté par le salarié', amount: noticeValue, kind: 'retenue', detail: `${notice.label} non effectué(s)` });

  // ─── Indemnite de licenciement ───
  let severanceReason = '';
  let eligible = false;
  if (!['licenciement', 'depart_negocie'].includes(i.reason)) severanceReason = 'Non due pour ce motif de départ.';
  else if (i.contractType !== 'cdi') severanceReason = 'Due uniquement pour un contrat à durée indéterminée.';
  else if (sen.years < 0.5) severanceReason = 'Moins de 6 mois de service.';
  else { eligible = true; severanceReason = 'Art. 53 : 96 h / an (≤ 5 ans), 144 h (6-10), 192 h (11-15), 240 h (> 15).'; }
  const hours = eligible ? r2(severanceHours(sen.years)) : 0;
  const severanceAmount = r2(hours * hourly);
  if (severanceAmount > 0) lines.push({ code: 'IND_LICENCIEMENT', label: 'Indemnité de licenciement', amount: severanceAmount, kind: 'gain', detail: `${f(hours)} h × ${f(hourly)} DH (${sen.label})` });

  // ─── Dommages-interets (licenciement abusif, sur decision) ───
  const maxDamages = Math.min(36, 1.5 * sen.years);
  const damagesMonths = Math.min(Math.max(0, i.damagesMonths ?? 0), maxDamages);
  const damagesAmount = r2(damagesMonths * ref);
  if (damagesAmount > 0) lines.push({ code: 'DOMMAGES_INTERETS', label: 'Dommages-intérêts', amount: damagesAmount, kind: 'gain', detail: `${f(damagesMonths)} mois × ${f(ref)} DH (plafond ${f(maxDamages)} mois)` });

  const totalGains = r2(lines.filter(l => l.kind === 'gain').reduce((s, l) => s + l.amount, 0));
  const totalDeductions = r2(lines.filter(l => l.kind === 'retenue').reduce((s, l) => s + l.amount, 0));
  return {
    seniorityYears: r2(sen.years), seniorityLabel: sen.label, referenceSalary: r2(ref),
    hourlyRate: r2(hourly), dailyRate: r2(daily),
    notice: { ...notice, due: employerOwes, amount: employerOwes || employeeOwes ? noticeValue : 0, owedByEmployee: employeeOwes },
    severance: { eligible, hours, amount: severanceAmount, reason: severanceReason },
    leave: { days: r2(i.leaveBalanceDays), amount: leaveAmount },
    damages: { months: r2(damagesMonths), amount: damagesAmount },
    lines, totalGains, totalDeductions,
  };
}
