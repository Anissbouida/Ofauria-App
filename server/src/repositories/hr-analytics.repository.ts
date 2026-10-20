import { db } from '../config/database.js';
import { computeHrAnalytics, type MonthlyMoney } from '../services/hr-analytics.js';
import { loadLeaveConfig, typeOf } from './leave.repository.js';
import { loadTimeRules } from './time-rules.repository.js';

/** Donnees brutes du pilotage RH d'une annee (lot 7), calcul dans hr-analytics. */

type Row = Record<string, any>;
const iso = (d: unknown): string | null => {
  if (!d) return null;
  if (d instanceof Date) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return String(d).slice(0, 10);
};

export async function hrAnalytics(year: number, storeId?: string) {
  const scope = storeId ? 'AND (e.store_id = $2 OR e.store_id IS NULL)' : '';
  const p = storeId ? [year, storeId] : [year];
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const [emps, roles, attendance, leaves, monthly, weekly, biweekly, revenue, leaveCfg, rules] = await Promise.all([
    // Fin d'emploi : date de sortie (lot 6), sinon pour un inactif la fin du
    // dernier contrat termine, sinon le dernier pointage.
    db.query(
      `SELECT e.id, e.first_name, e.last_name, e.role, e.contract_type, e.hire_date::text AS start, e.exit_reason,
              CASE WHEN e.exit_date IS NOT NULL THEN e.exit_date::text
                   WHEN e.is_active = false THEN COALESCE(
                     (SELECT MAX(c.end_date)::text FROM employee_contracts c WHERE c.employee_id = e.id AND c.status = 'ended'),
                     (SELECT MAX(a.date)::text FROM attendance a WHERE a.employee_id = e.id AND a.is_expected = false),
                     e.updated_at::date::text)
              END AS end_date
         FROM employees e
        WHERE e.hire_date IS NOT NULL AND e.hire_date <= ($1::int || '-12-31')::date ${scope}`, p),
    db.query(`SELECT code, label FROM ref_entries WHERE table_id = 'employee_roles'`),
    db.query(
      `SELECT a.employee_id, a.date::text AS date, a.status, a.check_in::text AS check_in, a.check_out::text AS check_out,
              COALESCE(a.overtime_minutes, 0) AS overtime_minutes
         FROM attendance a JOIN employees e ON e.id = a.employee_id
        WHERE a.is_expected = false AND EXTRACT(YEAR FROM a.date) = $1 ${scope}`, p),
    db.query(
      `SELECT l.employee_id, l.type, GREATEST(l.start_date, $1::date)::text AS start, LEAST(l.end_date, $2::date)::text AS end_d
         FROM leaves l JOIN employees e ON e.id = l.employee_id
        WHERE l.status = 'approved' AND l.start_date <= $2::date AND l.end_date >= $1::date
          ${storeId ? 'AND (e.store_id = $3 OR e.store_id IS NULL)' : ''}`,
      storeId ? [from, to, storeId] : [from, to]),
    db.query(
      `SELECT p.month, SUM(p.gross_salary) AS gross, SUM(p.total_charges_patron) AS charges,
              SUM(p.net_salary) AS net, SUM(p.overtime_amount) AS overtime
         FROM payroll p JOIN employees e ON e.id = p.employee_id
        WHERE p.year = $1 ${scope} GROUP BY p.month`, p),
    db.query(
      `SELECT EXTRACT(MONTH FROM w.week_start)::int AS month, SUM(w.net_amount) AS net, SUM(w.overtime_amount) AS overtime
         FROM weekly_payroll w JOIN employees e ON e.id = w.employee_id
        WHERE EXTRACT(YEAR FROM w.week_start) = $1 ${scope} GROUP BY 1`, p),
    db.query(
      `SELECT EXTRACT(MONTH FROM b.period_start)::int AS month, SUM(b.net_amount) AS net, SUM(b.overtime_amount) AS overtime
         FROM biweekly_payroll b JOIN employees e ON e.id = b.employee_id
        WHERE EXTRACT(YEAR FROM b.period_start) = $1 ${scope} GROUP BY 1`, p),
    // Chiffre d'affaires comptable HT (comptes 71, ecritures validees).
    db.query(
      `SELECT EXTRACT(MONTH FROM je.entry_date)::int AS month, SUM(l.credit - l.debit) AS revenue
         FROM journal_entry_lines l
         JOIN journal_entries je ON je.id = l.journal_entry_id
         JOIN accounts a ON a.id = l.account_id
        WHERE a.code LIKE '71%' AND je.status = 'posted' AND EXTRACT(YEAR FROM je.entry_date) = $1
          ${storeId ? 'AND (je.store_id = $2 OR je.store_id IS NULL)' : ''}
        GROUP BY 1`, p),
    loadLeaveConfig(),
    loadTimeRules(),
  ]);

  const roleLabel = new Map(roles.rows.map((r: Row) => [r.code, r.label]));
  const payroll: Record<number, MonthlyMoney> = {};
  const n = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
  for (let m = 1; m <= 12; m++) payroll[m] = { gross: 0, charges: 0, net: 0, overtime: 0, otherNet: 0 };
  for (const r of monthly.rows) Object.assign(payroll[r.month], { gross: n(r.gross), charges: n(r.charges), net: n(r.net), overtime: n(r.overtime) });
  for (const r of [...weekly.rows, ...biweekly.rows]) {
    payroll[r.month].otherNet += n(r.net);
    payroll[r.month].overtime += n(r.overtime);
  }
  const rev: Record<number, number> = {};
  for (const r of revenue.rows) rev[r.month] = n(r.revenue);

  return computeHrAnalytics({
    year,
    today: iso(new Date())!,
    restWeekday: rules.restWeekday,
    holidays: new Set(rules.holidays),
    weeklyLegalHours: rules.weeklyLegalHours,
    employees: emps.rows.map((e: Row) => ({
      id: e.id, name: `${e.first_name} ${e.last_name}`, role: roleLabel.get(e.role) ?? e.role,
      contractType: e.contract_type, start: e.start, end: e.end_date, exitReason: e.exit_reason,
    })),
    attendance: attendance.rows.map((a: Row) => ({
      employeeId: a.employee_id, date: a.date, status: a.status, checkIn: a.check_in, checkOut: a.check_out,
      overtimeMinutes: n(a.overtime_minutes),
    })),
    leaves: leaves.rows.map((l: Row) => {
      const t = typeOf(leaveCfg, l.type);
      return { employeeId: l.employee_id, start: l.start, end: l.end_d, paid: t.paid, unit: t.unit };
    }),
    payroll,
    revenue: rev,
  });
}
