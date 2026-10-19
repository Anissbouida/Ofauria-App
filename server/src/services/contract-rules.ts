/**
 * Regles de contrat de travail — fonctions PURES (lot 4, mig 322).
 *
 * Code du travail :
 *  - art. 13-14 : periode d'essai de 3 mois (cadre), 1,5 mois (employe),
 *    15 jours (ouvrier), renouvelable une fois ;
 *  - art. 16-17 : CDD pour un besoin temporaire ; pour une activite nouvelle,
 *    1 an renouvelable une fois, au-dela il devient CDI.
 */

export type Category = 'cadre' | 'employe' | 'ouvrier';

function addMonthsDays(iso: string, months: number, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d + days));
  return dt.toISOString().slice(0, 10);
}
const addDays = (iso: string, n: number) => addMonthsDays(iso, 0, n);
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86400000);

const TRIAL: Record<Category, { months: number; days: number; label: string }> = {
  cadre: { months: 3, days: 0, label: '3 mois' },
  employe: { months: 1, days: 15, label: '1,5 mois' },
  ouvrier: { months: 0, days: 15, label: '15 jours' },
};

/** Fin de la periode d'essai legale (dernier jour inclus). */
export function trialEndDate(start: string, category: Category): string {
  const t = TRIAL[category];
  return addDays(addMonthsDays(start, t.months, t.days), -1);
}
export const trialLabel = (category: Category) => TRIAL[category].label;

/** Renouvellement de l'essai : une seule fois, pour la meme duree. */
export function renewedTrialEnd(currentEnd: string, start: string, category: Category, alreadyRenewed: boolean): string {
  if (alreadyRenewed) throw new Error('La période d\'essai ne peut être renouvelée qu\'une fois.');
  const firstEnd = trialEndDate(start, category);
  return addDays(currentEnd, daysBetween(start, firstEnd) + 1);
}

export interface CddLink { kind: string; startDate: string; endDate: string | null }

/** Controle d'un renouvellement de CDD : nombre et duree cumulee (avertissements). */
export function cddRenewalWarnings(chain: CddLink[], newEnd: string): string[] {
  const warnings: string[] = [];
  const renewals = chain.filter(c => c.kind === 'renouvellement').length;
  if (renewals >= 1) warnings.push('Ce CDD a déjà été renouvelé : un second renouvellement le requalifie en CDI (art. 17).');
  const first = chain.reduce((m, c) => (c.startDate < m ? c.startDate : m), chain[0]?.startDate ?? newEnd);
  if (daysBetween(first, newEnd) + 1 > 366 * 2) warnings.push('Durée cumulée supérieure à 2 ans : le contrat est réputé à durée indéterminée.');
  return warnings;
}

export type AlertKind = 'cdd_expired' | 'cdd_end' | 'trial_end' | 'doc_expired' | 'doc_expiry' | 'missing_doc';
export interface HrAlert {
  employeeId: string;
  employeeName: string;
  kind: AlertKind;
  severity: 'danger' | 'warning' | 'info';
  date: string | null;
  daysLeft: number | null;
  message: string;
}

export interface AlertInput {
  today: string;
  horizonDays: number;
  employees: Array<{ id: string; name: string; isDeclared: boolean; cnssNumber: string | null; cin: string | null; cinExpiresOn: string | null }>;
  contracts: Array<{ employeeId: string; contractType: string; endDate: string | null; trialEndDate: string | null; status: string }>;
  documents: Array<{ employeeId: string; docType: string; title: string; expiresOn: string | null }>;
}

const fr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Alertes RH : fins de CDD et d'essai, pieces expirees ou manquantes. */
export function computeHrAlerts(input: AlertInput): HrAlert[] {
  const out: HrAlert[] = [];
  const names = new Map(input.employees.map(e => [e.id, e.name]));
  const active = input.contracts.filter(c => c.status === 'active' && names.has(c.employeeId));

  for (const c of active) {
    const name = names.get(c.employeeId)!;
    if (c.endDate && ['cdd', 'stage', 'interim', 'saisonnier'].includes(c.contractType)) {
      const left = daysBetween(input.today, c.endDate);
      if (left < 0) {
        out.push({ employeeId: c.employeeId, employeeName: name, kind: 'cdd_expired', severity: 'danger', date: c.endDate, daysLeft: left,
          message: `${c.contractType.toUpperCase()} échu le ${fr(c.endDate)} : renouveler, passer en CDI ou clôturer le contrat (poursuite = CDI).` });
      } else if (left <= input.horizonDays) {
        out.push({ employeeId: c.employeeId, employeeName: name, kind: 'cdd_end', severity: left <= 7 ? 'danger' : 'warning', date: c.endDate, daysLeft: left,
          message: `${c.contractType.toUpperCase()} se termine le ${fr(c.endDate)} (dans ${left} j).` });
      }
    }
    if (c.trialEndDate) {
      const left = daysBetween(input.today, c.trialEndDate);
      if (left >= 0 && left <= Math.min(input.horizonDays, 15)) {
        out.push({ employeeId: c.employeeId, employeeName: name, kind: 'trial_end', severity: 'warning', date: c.trialEndDate, daysLeft: left,
          message: `Fin de période d'essai le ${fr(c.trialEndDate)} (dans ${left} j) : confirmer, renouveler une fois ou rompre.` });
      }
    }
  }

  const expiring = [
    ...input.documents.filter(d => d.expiresOn).map(d => ({ employeeId: d.employeeId, label: d.title, date: d.expiresOn as string })),
    ...input.employees.filter(e => e.cinExpiresOn).map(e => ({ employeeId: e.id, label: 'CIN', date: e.cinExpiresOn as string })),
  ];
  for (const d of expiring) {
    const name = names.get(d.employeeId);
    if (!name) continue;
    const left = daysBetween(input.today, d.date);
    if (left < 0) out.push({ employeeId: d.employeeId, employeeName: name, kind: 'doc_expired', severity: 'danger', date: d.date, daysLeft: left, message: `${d.label} expiré(e) depuis le ${fr(d.date)}.` });
    else if (left <= input.horizonDays) out.push({ employeeId: d.employeeId, employeeName: name, kind: 'doc_expiry', severity: 'warning', date: d.date, daysLeft: left, message: `${d.label} expire le ${fr(d.date)} (dans ${left} j).` });
  }

  for (const e of input.employees) {
    const docs = new Set(input.documents.filter(d => d.employeeId === e.id).map(d => d.docType));
    const missing: string[] = [];
    if (!docs.has('contrat')) missing.push('contrat signé');
    if (!docs.has('cin') && !e.cin) missing.push('CIN');
    if (e.isDeclared && !e.cnssNumber) missing.push('n° CNSS');
    if (missing.length) {
      out.push({ employeeId: e.id, employeeName: e.name, kind: 'missing_doc', severity: 'info', date: null, daysLeft: null, message: `Dossier incomplet : ${missing.join(', ')}.` });
    }
  }

  const rank = { danger: 0, warning: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));
}
