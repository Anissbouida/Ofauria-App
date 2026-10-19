import { db } from '../config/database.js';
import {
  classifyOvertime, holidayDays, DEFAULT_OT_RATES,
  type OvertimeHours, type OvertimeRates,
} from '../services/overtime-engine.js';

/**
 * Regles de temps de travail (lot 3, mig 321) : majorations d'heures sup,
 * durees legales, jours feries, contingent annuel ; et faits de temps d'une
 * periode (heures sup ventilees, feries payes / travailles) pour les paies.
 */

export interface TimeRules {
  otRates: OvertimeRates;
  monthlyLegalHours: number;
  weeklyLegalHours: number;
  holidayWorkedRate: number;
  restWeekday: number;
  nightStart: string;
  nightEnd: string;
  annualQuotaHours: number;
  holidays: string[];
}

const iso = (d: unknown): string => {
  if (d instanceof Date) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return String(d).slice(0, 10);
};
const num = (v: unknown, d: number) => (v === null || v === undefined ? d : parseFloat(String(v)));

export async function loadTimeRules(): Promise<TimeRules> {
  const [s, h] = await Promise.all([
    db.query('SELECT * FROM payroll_settings WHERE id = 1'),
    db.query('SELECT holiday_date::text AS d FROM public_holidays'),
  ]);
  const r = s.rows[0] ?? {};
  return {
    otRates: {
      day: num(r.ot_rate_day, DEFAULT_OT_RATES.day), night: num(r.ot_rate_night, DEFAULT_OT_RATES.night),
      restDay: num(r.ot_rate_rest_day, DEFAULT_OT_RATES.restDay), restNight: num(r.ot_rate_rest_night, DEFAULT_OT_RATES.restNight),
    },
    monthlyLegalHours: num(r.monthly_legal_hours, 191),
    weeklyLegalHours: num(r.weekly_legal_hours, 44),
    holidayWorkedRate: num(r.holiday_worked_rate, 1),
    restWeekday: r.leave_rest_weekday ?? 0,
    nightStart: String(r.night_start ?? '21:00').slice(0, 5),
    nightEnd: String(r.night_end ?? '06:00').slice(0, 5),
    annualQuotaHours: num(r.ot_annual_quota_hours, 100),
    holidays: h.rows.map((x: { d: string }) => x.d),
  };
}

export interface PeriodTimeFacts { overtime: OvertimeHours; holidayPaid: number; holidayWorked: number }

/** Heures sup ventilees et jours feries d'un employe sur [from, to] (pointage reel). */
export async function periodTimeFacts(employeeId: string, from: string, to: string, rules: TimeRules, hireDate?: unknown): Promise<PeriodTimeFacts> {
  const rows = (await db.query(
    `SELECT date::text AS date, status, overtime_minutes, overtime_night_minutes, is_rest_day
       FROM attendance
      WHERE employee_id = $1 AND date BETWEEN $2 AND $3 AND is_expected = false`,
    [employeeId, from, to]
  )).rows;
  const overtime = classifyOvertime(rows.map((r: Record<string, any>) => ({
    date: r.date, overtimeMinutes: r.overtime_minutes ?? 0,
    overtimeNightMinutes: r.overtime_night_minutes ?? 0, isRestDay: r.is_rest_day,
  })), rules.restWeekday);
  const statusByDate = new Map<string, string>(rows.map((r: Record<string, any>) => [r.date, r.status]));
  const h = holidayDays(rules.holidays, from, to, statusByDate, { restWeekday: rules.restWeekday, hireDate: hireDate ? iso(hireDate) : null });
  return { overtime, holidayPaid: h.paid, holidayWorked: h.worked };
}

/** Cumul annuel des heures sup par employe (contingent legal). */
export async function overtimeYearSummary(year: number, storeId?: string) {
  const rules = await loadTimeRules();
  const r = await db.query(
    `SELECT e.id, e.first_name, e.last_name,
            COALESCE(SUM(a.overtime_minutes), 0)::int AS minutes,
            COALESCE(SUM(a.overtime_night_minutes), 0)::int AS night_minutes
       FROM employees e
       LEFT JOIN attendance a ON a.employee_id = e.id AND a.is_expected = false
        AND a.date BETWEEN $1::date AND $2::date
      WHERE e.is_active = true ${storeId ? 'AND (e.store_id = $3 OR e.store_id IS NULL)' : ''}
      GROUP BY e.id
      ORDER BY minutes DESC, e.last_name`,
    storeId ? [`${year}-01-01`, `${year}-12-31`, storeId] : [`${year}-01-01`, `${year}-12-31`]
  );
  return {
    quotaHours: rules.annualQuotaHours,
    rows: r.rows.map((x: Record<string, any>) => {
      const hours = Math.round((x.minutes / 60) * 100) / 100;
      return {
        employeeId: x.id, name: `${x.first_name} ${x.last_name}`, hours,
        nightHours: Math.round((x.night_minutes / 60) * 100) / 100,
        quotaUsedPct: Math.round((hours / rules.annualQuotaHours) * 1000) / 10,
        overQuota: hours > rules.annualQuotaHours,
      };
    }),
  };
}
