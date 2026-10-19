/**
 * Congés payés marocains — fonctions PURES (aucun accès base).
 *
 * Code du travail :
 *  - art. 231 : 1,5 jour ouvrable par mois de service (2 jours pour un
 *    salarié de moins de 18 ans) ;
 *  - art. 241 : +1,5 jour par période de 5 ans de service, sans dépasser
 *    30 jours ouvrables par an ;
 *  - art. 232 : les jours fériés ne sont pas décomptés du congé ;
 *  - art. 240 : fractionnement ou cumul sur deux années consécutives (report).
 *
 * Modèle : chaque année produit un « lot » de droits (acquis + ajustements),
 * utilisable l'année même et pendant `carryoverYears` années ; au-delà, le
 * reliquat expire. Les congés pris consomment les lots du plus ancien au plus
 * récent (FIFO). Un solde négatif (congé anticipé) est permis et porté tel quel.
 */

export interface LeaveEngineInput {
  hireDate: string;            // YYYY-MM-DD
  birthDate?: string | null;   // pour le taux mineur
  asOf: string;                // date de calcul
  daysPerMonth?: number;       // 1,5 par défaut
  carryoverYears?: number;     // 1 par défaut (cumul sur 2 années)
  takenByYear: Record<number, number>;
  adjustmentsByYear?: Record<number, number>;
}

export interface LeaveYear {
  year: number;
  months: number;
  annualEntitlement: number;
  acquired: number;
  adjustments: number;
  taken: number;
  expired: number;
  /** Solde disponible en fin d'année (ou à asOf pour l'année en cours). */
  balance: number;
}

export interface LeaveBalance {
  years: LeaveYear[];
  available: number;
  acquiredThisYear: number;
  takenThisYear: number;
  /** Reliquat des années précédentes encore utilisable. */
  carriedOver: number;
  /** Jours qui expireront au 31/12 de l'année en cours s'ils ne sont pas pris. */
  expiringThisYear: number;
  seniorityBonus: number;
}

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

function ymd(s: string): [number, number, number] {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return [y, m, d];
}

/** Mois entiers entre deux dates (fin exclue). */
export function fullMonthsBetween(start: string, endExclusive: string): number {
  const [sy, sm, sd] = ymd(start);
  const [ey, em, ed] = ymd(endExclusive);
  let months = (ey - sy) * 12 + (em - sm);
  if (ed < sd) months--;
  return Math.max(0, months);
}

function yearsBetween(start: string, at: string): number {
  return Math.floor(fullMonthsBetween(start, at) / 12);
}

const addDay = (s: string) => {
  const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Droit annuel plein d'une année : 18 j (ou 24 j mineur) + ancienneté, plafond 30. */
export function annualEntitlement(perMonth: number, serviceYearsAtYearEnd: number): { total: number; bonus: number } {
  const bonus = Math.floor(serviceYearsAtYearEnd / 5) * 1.5;
  return { total: Math.min(30, r2(perMonth * 12 + bonus)), bonus };
}

export function computeLeaveBalance(input: LeaveEngineInput): LeaveBalance {
  const perMonthBase = input.daysPerMonth ?? 1.5;
  const carry = input.carryoverYears ?? 1;
  const [hireY] = ymd(input.hireDate);
  const [asY] = ymd(input.asOf);
  const asOfExclusive = addDay(input.asOf);

  type Lot = { year: number; remaining: number };
  const lots: Lot[] = [];
  let overdraft = 0; // consommation au-delà des droits (solde négatif)
  const years: LeaveYear[] = [];
  let seniorityBonus = 0;

  for (let y = hireY; y <= asY; y++) {
    // Expiration des lots trop anciens au 1er janvier de y.
    let expiredAtStart = 0;
    for (const lot of lots) {
      if (lot.year + carry < y && lot.remaining > 0) { expiredAtStart += lot.remaining; lot.remaining = 0; }
    }
    if (years.length && expiredAtStart > 0) years[years.length - 1].expired = r2(expiredAtStart);

    const from = y === hireY ? input.hireDate : `${y}-01-01`;
    const to = y === asY ? asOfExclusive : `${y + 1}-01-01`;
    const months = Math.min(12, fullMonthsBetween(from, to));
    const minor = input.birthDate ? yearsBetween(input.birthDate, `${y}-12-31`) < 18 : false;
    const perMonth = minor ? Math.max(2, perMonthBase) : perMonthBase;
    const service = yearsBetween(input.hireDate, y === asY ? input.asOf : `${y}-12-31`);
    const ent = annualEntitlement(perMonth, service);
    if (y === asY) seniorityBonus = ent.bonus;
    const acquired = r2(Math.min(ent.total, (months * ent.total) / 12));
    const adjustments = r2(input.adjustmentsByYear?.[y] ?? 0);

    // Le lot de l'année rembourse d'abord un éventuel découvert antérieur.
    let fresh = r2(acquired + adjustments);
    if (overdraft > 0 && fresh > 0) { const pay = Math.min(overdraft, fresh); overdraft = r2(overdraft - pay); fresh = r2(fresh - pay); }
    if (fresh < 0) { overdraft = r2(overdraft - fresh); fresh = 0; }
    lots.push({ year: y, remaining: fresh });

    // Consommation FIFO des congés pris dans l'année.
    let toTake = r2(input.takenByYear[y] ?? 0);
    for (const lot of lots) {
      if (toTake <= 0) break;
      if (lot.remaining <= 0 || lot.year + carry < y) continue;
      const use = Math.min(lot.remaining, toTake);
      lot.remaining = r2(lot.remaining - use);
      toTake = r2(toTake - use);
    }
    if (toTake > 0) overdraft = r2(overdraft + toTake);

    const live = lots.filter(l => l.year + carry >= y).reduce((s, l) => s + l.remaining, 0);
    years.push({
      year: y, months, annualEntitlement: ent.total, acquired, adjustments,
      taken: r2(input.takenByYear[y] ?? 0), expired: 0, balance: r2(live - overdraft),
    });
  }

  const current = years[years.length - 1];
  const liveNow = lots.filter(l => l.year + carry >= asY);
  const carriedOver = r2(liveNow.filter(l => l.year < asY).reduce((s, l) => s + l.remaining, 0));
  const expiringThisYear = r2(lots.filter(l => l.year + carry === asY).reduce((s, l) => s + l.remaining, 0));
  return {
    years,
    available: current ? current.balance : 0,
    acquiredThisYear: current?.acquired ?? 0,
    takenThisYear: current?.taken ?? 0,
    carriedOver,
    expiringThisYear,
    seniorityBonus,
  };
}

/** Jours d'un congé : ouvrables (hors repos hebdomadaire et fériés) ou calendaires. */
export function countLeaveDays(start: string, end: string, opts: { unit: 'ouvrable' | 'calendaire'; restWeekday: number; holidays: Set<string> }): number {
  let n = 0;
  for (let d = start.slice(0, 10); d <= end.slice(0, 10); d = addDay(d)) {
    if (opts.unit === 'calendaire') { n++; continue; }
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd === opts.restWeekday || opts.holidays.has(d)) continue;
    n++;
  }
  return n;
}

/** Dates (YYYY-MM-DD) d'un congé comptées dans la paie, bornées à [from, to]. */
export function leaveDates(start: string, end: string, from: string, to: string, opts: { unit: 'ouvrable' | 'calendaire'; restWeekday: number; holidays: Set<string> }): string[] {
  const out: string[] = [];
  const a = start.slice(0, 10) > from ? start.slice(0, 10) : from;
  const b = end.slice(0, 10) < to ? end.slice(0, 10) : to;
  for (let d = a; d <= b; d = addDay(d)) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (opts.unit === 'ouvrable' && (wd === opts.restWeekday || opts.holidays.has(d))) continue;
    out.push(d);
  }
  return out;
}
