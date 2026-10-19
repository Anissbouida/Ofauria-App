import { db } from '../config/database.js';
import { computeLeaveBalance, countLeaveDays, leaveDates, type LeaveBalance } from '../services/leave-engine.js';

/**
 * Congés légaux (lot 2, mig 320) : paramétrage (types, repos hebdomadaire,
 * jours fériés), décompte des jours, soldes, ajustements, et jours de congé
 * payé à compter dans la paie.
 */

export interface LeaveTypeConfig { code: string; label: string; paid: boolean; deductsBalance: boolean; unit: 'ouvrable' | 'calendaire' }
export interface LeaveConfig {
  restWeekday: number;
  daysPerMonth: number;
  carryoverYears: number;
  holidays: Set<string>;
  types: Map<string, LeaveTypeConfig>;
}

// Repli si ref_entries n'a pas de metadata (base non migree) ; 'paid' = ancien code du conge annuel.
const DEFAULT_TYPES: Record<string, Omit<LeaveTypeConfig, 'code' | 'label'>> = {
  annual: { paid: true, deductsBalance: true, unit: 'ouvrable' },
  paid: { paid: true, deductsBalance: true, unit: 'ouvrable' },
  paternity: { paid: true, deductsBalance: false, unit: 'ouvrable' },
  exceptional: { paid: true, deductsBalance: false, unit: 'ouvrable' },
  sick: { paid: false, deductsBalance: false, unit: 'calendaire' },
  maternity: { paid: false, deductsBalance: false, unit: 'calendaire' },
  unpaid: { paid: false, deductsBalance: false, unit: 'ouvrable' },
  other: { paid: false, deductsBalance: false, unit: 'ouvrable' },
};

const iso = (d: unknown): string => {
  if (d instanceof Date) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return String(d).slice(0, 10);
};
const todayIso = () => iso(new Date());

export async function loadLeaveConfig(): Promise<LeaveConfig> {
  const [settings, holidays, types] = await Promise.all([
    db.query('SELECT * FROM payroll_settings WHERE id = 1'),
    db.query('SELECT holiday_date FROM public_holidays'),
    db.query(`SELECT code, label, metadata FROM ref_entries WHERE table_id = 'leave_types'`),
  ]);
  const s = settings.rows[0] ?? {};
  const map = new Map<string, LeaveTypeConfig>();
  for (const [code, d] of Object.entries(DEFAULT_TYPES)) map.set(code, { code, label: code, ...d });
  for (const t of types.rows) {
    const m = t.metadata ?? {};
    const d = DEFAULT_TYPES[t.code] ?? { paid: false, deductsBalance: false, unit: 'ouvrable' as const };
    map.set(t.code, {
      code: t.code, label: t.label,
      paid: typeof m.paid === 'boolean' ? m.paid : d.paid,
      deductsBalance: typeof m.deducts_balance === 'boolean' ? m.deducts_balance : d.deductsBalance,
      unit: m.unit === 'calendaire' ? 'calendaire' : m.unit === 'ouvrable' ? 'ouvrable' : d.unit,
    });
  }
  return {
    restWeekday: s.leave_rest_weekday ?? 0,
    daysPerMonth: parseFloat(s.leave_days_per_month ?? '1.5') || 1.5,
    carryoverYears: s.leave_carryover_years ?? 1,
    holidays: new Set(holidays.rows.map((h: { holiday_date: unknown }) => iso(h.holiday_date))),
    types: map,
  };
}

export function typeOf(cfg: LeaveConfig, code: string): LeaveTypeConfig {
  return cfg.types.get(code) ?? { code, label: code, paid: false, deductsBalance: false, unit: 'ouvrable' };
}

export function leaveDayCount(cfg: LeaveConfig, type: string, start: string, end: string): number {
  return countLeaveDays(start, end, { unit: typeOf(cfg, type).unit, restWeekday: cfg.restWeekday, holidays: cfg.holidays });
}

export const leaveBalanceRepository = {
  /** Solde d'un employe a une date (droits, report, pris, ajustements) + demandes en attente. */
  async forEmployee(employeeId: string, asOf = todayIso(), cfg?: LeaveConfig): Promise<(LeaveBalance & { pending: number; hireDate: string }) | null> {
    const conf = cfg ?? await loadLeaveConfig();
    const emp = (await db.query('SELECT id, hire_date, birth_date FROM employees WHERE id = $1', [employeeId])).rows[0];
    if (!emp?.hire_date) return null;
    const deducting = [...conf.types.values()].filter(t => t.deductsBalance).map(t => t.code);
    const [leaves, adjustments] = await Promise.all([
      db.query(
        `SELECT EXTRACT(YEAR FROM start_date)::int AS year, status, SUM(days) AS days
           FROM leaves WHERE employee_id = $1 AND type = ANY($2::text[]) AND status IN ('approved', 'pending')
          GROUP BY 1, 2`,
        [employeeId, deducting]
      ),
      db.query(`SELECT year, SUM(days) AS days FROM leave_adjustments WHERE employee_id = $1 GROUP BY year`, [employeeId]),
    ]);
    const takenByYear: Record<number, number> = {};
    let pending = 0;
    for (const l of leaves.rows) {
      if (l.status === 'approved') takenByYear[l.year] = (takenByYear[l.year] ?? 0) + parseFloat(l.days);
      else pending += parseFloat(l.days);
    }
    const adjustmentsByYear: Record<number, number> = {};
    for (const a of adjustments.rows) adjustmentsByYear[a.year] = parseFloat(a.days);
    // Conges pris par annee de debut ; ceux d'une annee posterieure a asOf
    // ne sont pas encore imputes (ils le seront sur les droits de leur annee).
    const balance = computeLeaveBalance({
      hireDate: iso(emp.hire_date), birthDate: emp.birth_date ? iso(emp.birth_date) : null, asOf,
      daysPerMonth: conf.daysPerMonth, carryoverYears: conf.carryoverYears, takenByYear, adjustmentsByYear,
    });
    return { ...balance, pending: Math.round(pending * 100) / 100, hireDate: iso(emp.hire_date) };
  },

  /** Soldes de tous les employes actifs (perimetre magasin). */
  async all(storeId?: string, asOf = todayIso()) {
    const cfg = await loadLeaveConfig();
    const emps = await db.query(
      `SELECT id, first_name, last_name, role FROM employees
        WHERE is_active = true ${storeId ? 'AND (store_id = $1 OR store_id IS NULL)' : ''}
        ORDER BY last_name, first_name`,
      storeId ? [storeId] : []
    );
    const out = [];
    for (const e of emps.rows) {
      const b = await this.forEmployee(e.id, asOf, cfg);
      out.push({
        employeeId: e.id, name: `${e.first_name} ${e.last_name}`, role: e.role,
        hireDate: b?.hireDate ?? null,
        acquiredThisYear: b?.acquiredThisYear ?? 0, carriedOver: b?.carriedOver ?? 0,
        takenThisYear: b?.takenThisYear ?? 0, pending: b?.pending ?? 0,
        available: b?.available ?? 0, expiringThisYear: b?.expiringThisYear ?? 0,
        seniorityBonus: b?.seniorityBonus ?? 0,
      });
    }
    return out;
  },

  /**
   * Jours de conge PAYE (types « paid ») approuves sur [from, to], hors jours
   * deja couverts par un pointage reel : comptes comme travailles dans la paie.
   */
  async paidLeaveDays(employeeId: string, from: string, to: string, cfg?: LeaveConfig): Promise<number> {
    const conf = cfg ?? await loadLeaveConfig();
    const paid = [...conf.types.values()].filter(t => t.paid).map(t => t.code);
    const leaves = await db.query(
      `SELECT type, start_date, end_date FROM leaves
        WHERE employee_id = $1 AND status = 'approved' AND type = ANY($2::text[])
          AND start_date <= $4::date AND end_date >= $3::date`,
      [employeeId, paid, from, to]
    );
    if (!leaves.rowCount) return 0;
    const attended = new Set((await db.query(
      `SELECT date FROM attendance WHERE employee_id = $1 AND date BETWEEN $2 AND $3 AND is_expected = false`,
      [employeeId, from, to]
    )).rows.map((r: { date: unknown }) => iso(r.date)));
    const days = new Set<string>();
    for (const l of leaves.rows) {
      for (const d of leaveDates(iso(l.start_date), iso(l.end_date), from, to, { unit: typeOf(conf, l.type).unit, restWeekday: conf.restWeekday, holidays: conf.holidays })) {
        if (!attended.has(d)) days.add(d);
      }
    }
    return days.size;
  },
};

export const holidayRepository = {
  async list(year?: number) {
    const r = await db.query(
      // ::text : renvoie 'YYYY-MM-DD' tel quel (un DATE serialise en JSON peut
      // reculer d'un jour selon le fuseau du serveur).
      `SELECT holiday_date::text AS holiday_date, label, is_confirmed, created_at FROM public_holidays
        ${year ? 'WHERE EXTRACT(YEAR FROM holiday_date) = $1' : ''} ORDER BY holiday_date`,
      year ? [year] : []
    );
    return r.rows;
  },
  async upsert(date: string, label: string, isConfirmed: boolean) {
    const r = await db.query(
      `INSERT INTO public_holidays (holiday_date, label, is_confirmed) VALUES ($1, $2, $3)
       ON CONFLICT (holiday_date) DO UPDATE SET label = EXCLUDED.label, is_confirmed = EXCLUDED.is_confirmed
       RETURNING *`,
      [date, label, isConfirmed]
    );
    return r.rows[0];
  },
  async remove(date: string) {
    await db.query('DELETE FROM public_holidays WHERE holiday_date = $1', [date]);
  },
};

export const leaveAdjustmentRepository = {
  async list(employeeId: string) {
    const r = await db.query(
      `SELECT a.*, u.first_name AS created_by_first_name, u.last_name AS created_by_last_name
         FROM leave_adjustments a LEFT JOIN users u ON u.id = a.created_by
        WHERE a.employee_id = $1 ORDER BY a.year DESC, a.created_at DESC`,
      [employeeId]
    );
    return r.rows;
  },
  async create(data: { employeeId: string; year: number; days: number; reason: string }, userId?: string) {
    const r = await db.query(
      `INSERT INTO leave_adjustments (employee_id, year, days, reason, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [data.employeeId, data.year, data.days, data.reason, userId ?? null]
    );
    return r.rows[0];
  },
  async findById(id: string) {
    return (await db.query('SELECT * FROM leave_adjustments WHERE id = $1', [id])).rows[0] ?? null;
  },
  async remove(id: string) {
    await db.query('DELETE FROM leave_adjustments WHERE id = $1', [id]);
  },
};
