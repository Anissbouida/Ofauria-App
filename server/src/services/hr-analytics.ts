/**
 * Pilotage RH — calculs PURS (lot 7). Le repository fournit les donnees
 * brutes de l'annee ; tout le calcul des indicateurs est ici, testable.
 *
 * Definitions :
 *  - effectif fin de mois : salaries embauches avant la fin du mois et non
 *    sortis a cette date ;
 *  - turnover = sorties de l'annee / effectif moyen ; rotation = (entrees +
 *    sorties) / 2 / effectif moyen ;
 *  - absenteisme = jours d'absence / jours theoriques (jours ouvrables de la
 *    periode d'emploi, hors repos hebdomadaire et feries) ; absence = absence
 *    pointee, demi-journee (0,5), conges non payes par l'employeur (maladie,
 *    sans solde, maternite...) ; les conges payes ne sont pas de l'absenteisme ;
 *  - heures travaillees : duree pointee (arrivee -> depart), sinon journee
 *    standard (duree legale / 6 jours) + heures sup ;
 *  - cout de main-d'oeuvre = brut + charges patronales (mensuels) + net verse
 *    (hebdo, quinzaine, non declares) ; ratio au chiffre d'affaires comptable.
 */

export interface AnalyticsEmployee {
  id: string; name: string; role: string; contractType: string | null;
  start: string; end: string | null; exitReason: string | null;
}
export interface AnalyticsAttendance { employeeId: string; date: string; status: string; checkIn: string | null; checkOut: string | null; overtimeMinutes: number }
export interface AnalyticsLeave { employeeId: string; start: string; end: string; paid: boolean; unit: 'ouvrable' | 'calendaire' }
export interface MonthlyMoney { gross: number; charges: number; net: number; overtime: number; otherNet: number }

export interface AnalyticsInput {
  year: number;
  today: string;
  restWeekday: number;
  holidays: Set<string>;
  weeklyLegalHours: number;
  employees: AnalyticsEmployee[];
  attendance: AnalyticsAttendance[];
  leaves: AnalyticsLeave[];
  payroll: Record<number, MonthlyMoney>;   // 1..12
  revenue: Record<number, number>;          // 1..12, CA comptable HT
}

export interface MonthStats {
  month: number;
  headcount: number;
  entries: number;
  exits: number;
  grossPayroll: number;
  employerCharges: number;
  otherPayroll: number;
  laborCost: number;
  overtimeCost: number;
  revenue: number;
  laborCostRatio: number | null;
  theoreticalDays: number;
  absenceDays: number;
  absenteeismRate: number | null;
  /** Mois sans aucun pointage : absenteisme non mesurable (exclu du taux annuel). */
  tracked: boolean;
  hoursWorked: number;
  costPerHour: number | null;
}

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const r1 = (v: number) => Math.round((v + Number.EPSILON) * 10) / 10;
const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addDay = (s: string) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const weekday = (s: string) => new Date(`${s}T00:00:00Z`).getUTCDay();
const toMin = (t: string) => { const [h, m] = t.slice(0, 5).split(':').map(Number); return h * 60 + m; };

function employedOn(e: AnalyticsEmployee, d: string) {
  return e.start <= d && (!e.end || e.end >= d);
}

/** Heures d'une journee pointee. */
export function attendanceHours(a: AnalyticsAttendance, weeklyLegalHours: number): number {
  const std = weeklyLegalHours / 6;
  if (a.checkIn && a.checkOut) {
    let mins = toMin(a.checkOut) - toMin(a.checkIn);
    if (mins <= 0) mins += 1440;
    return mins / 60;
  }
  const base = a.status === 'present' || a.status === 'late' ? std
    : a.status === 'half_day' ? std / 2
    : a.status === 'double' ? std * 2 : 0;
  return base + (a.overtimeMinutes || 0) / 60;
}

export function computeHrAnalytics(i: AnalyticsInput) {
  const months: MonthStats[] = [];
  const att = new Map<string, AnalyticsAttendance>();
  for (const a of i.attendance) att.set(`${a.employeeId}|${a.date}`, a);

  // Jours d'absence par conge non paye : employe|date -> true (jours ouvrables ou calendaires).
  const unpaidLeaveDays = new Set<string>();
  for (const l of i.leaves) {
    if (l.paid) continue;
    for (let d = l.start; d <= l.end; d = addDay(d)) {
      if (l.unit === 'ouvrable' && (weekday(d) === i.restWeekday || i.holidays.has(d))) continue;
      unpaidLeaveDays.add(`${l.employeeId}|${d}`);
    }
  }
  const absenceByEmployee = new Map<string, number>();
  const yearEnd = `${i.year}-12-31` < i.today ? `${i.year}-12-31` : i.today;

  for (let m = 1; m <= 12; m++) {
    const from = `${i.year}-${pad(m)}-01`;
    const to = `${i.year}-${pad(m)}-${pad(lastDay(i.year, m))}`;
    if (from > i.today) break;
    const until = to < i.today ? to : i.today;
    const headcount = i.employees.filter(e => employedOn(e, until)).length;
    const entries = i.employees.filter(e => e.start >= from && e.start <= to).length;
    const exits = i.employees.filter(e => e.end && e.end >= from && e.end <= to).length;

    let theoretical = 0;
    let absence = 0;
    let hours = 0;
    const tracked = i.attendance.some(a => a.date >= from && a.date <= to);
    for (const e of i.employees) {
      for (let d = from; d <= until; d = addDay(d)) {
        if (!employedOn(e, d)) continue;
        const a = att.get(`${e.id}|${d}`);
        if (a) hours += attendanceHours(a, i.weeklyLegalHours);
        if (weekday(d) === i.restWeekday || i.holidays.has(d)) continue;
        theoretical++;
        let abs = 0;
        if (a?.status === 'absent') abs = 1;
        else if (a?.status === 'half_day') abs = 0.5;
        else if (!a && unpaidLeaveDays.has(`${e.id}|${d}`)) abs = 1;
        if (abs) { absence += abs; absenceByEmployee.set(e.id, (absenceByEmployee.get(e.id) ?? 0) + abs); }
      }
    }

    const money = i.payroll[m] ?? { gross: 0, charges: 0, net: 0, overtime: 0, otherNet: 0 };
    const laborCost = r2(money.gross + money.charges + money.otherNet);
    const revenue = r2(i.revenue[m] ?? 0);
    months.push({
      month: m, headcount, entries, exits,
      grossPayroll: r2(money.gross), employerCharges: r2(money.charges), otherPayroll: r2(money.otherNet),
      laborCost, overtimeCost: r2(money.overtime), revenue,
      laborCostRatio: revenue > 0 ? r1((laborCost / revenue) * 100) : null,
      theoreticalDays: tracked ? theoretical : 0, absenceDays: r1(absence),
      absenteeismRate: tracked && theoretical > 0 ? r1((absence / theoretical) * 100) : null,
      tracked,
      hoursWorked: r1(hours), costPerHour: hours > 0 && laborCost > 0 ? r2(laborCost / hours) : null,
    });
  }

  const sum = (k: keyof MonthStats) => months.reduce((s, x) => s + (Number(x[k]) || 0), 0);
  const avgHeadcount = months.length ? sum('headcount') / months.length : 0;
  const exits = sum('exits');
  const entries = sum('entries');
  const theoretical = sum('theoreticalDays');
  const laborCost = sum('laborCost');
  const revenue = sum('revenue');
  const hours = sum('hoursWorked');

  // Repartitions sur l'effectif present en fin de periode.
  const active = i.employees.filter(e => employedOn(e, yearEnd));
  const bucket = (e: AnalyticsEmployee) => {
    const y = (Date.parse(`${yearEnd}T00:00:00Z`) - Date.parse(`${e.start}T00:00:00Z`)) / (365.25 * 86400000);
    return y < 1 ? '< 1 an' : y < 3 ? '1-3 ans' : y < 5 ? '3-5 ans' : y < 10 ? '5-10 ans' : '10 ans et +';
  };
  const count = (keys: string[]) => {
    const m = new Map<string, number>();
    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  };
  const seniorityOrder = ['< 1 an', '1-3 ans', '3-5 ans', '5-10 ans', '10 ans et +'];

  return {
    year: i.year,
    months,
    totals: {
      headcount: months.length ? months[months.length - 1].headcount : 0,
      averageHeadcount: r1(avgHeadcount),
      entries, exits,
      turnoverRate: avgHeadcount > 0 ? r1((exits / avgHeadcount) * 100) : null,
      rotationRate: avgHeadcount > 0 ? r1(((entries + exits) / 2 / avgHeadcount) * 100) : null,
      grossPayroll: r2(sum('grossPayroll')), employerCharges: r2(sum('employerCharges')),
      otherPayroll: r2(sum('otherPayroll')), laborCost: r2(laborCost), overtimeCost: r2(sum('overtimeCost')),
      revenue: r2(revenue), laborCostRatio: revenue > 0 ? r1((laborCost / revenue) * 100) : null,
      absenceDays: r1(sum('absenceDays')), theoreticalDays: theoretical,
      absenteeismRate: theoretical > 0 ? r1((sum('absenceDays') / theoretical) * 100) : null,
      hoursWorked: r1(hours), costPerHour: hours > 0 && laborCost > 0 ? r2(laborCost / hours) : null,
    },
    breakdowns: {
      byRole: count(active.map(e => e.role)),
      byContract: count(active.map(e => (e.contractType ?? 'cdi').toUpperCase())),
      bySeniority: count(active.map(bucket)).sort((a, b) => seniorityOrder.indexOf(a.label) - seniorityOrder.indexOf(b.label)),
      exitReasons: count(i.employees.filter(e => e.end && e.end.startsWith(String(i.year))).map(e => e.exitReason ?? 'non renseigné')),
    },
    topAbsentees: [...absenceByEmployee.entries()]
      .map(([id, days]) => ({ employeeId: id, name: i.employees.find(e => e.id === id)?.name ?? id, days: r1(days) }))
      .sort((a, b) => b.days - a.days).slice(0, 5),
  };
}
