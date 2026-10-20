import { db } from '../config/database.js';
import {
  computeMonthlyPayslip, serviceYears, taxScaleFromRow,
  type RubriqueInput, type TaxScale, type IrCumul, type PeriodicGross,
} from '../services/payroll-engine.js';
import { leaveBalanceRepository } from './leave.repository.js';
import { loadTimeRules, periodTimeFacts, type TimeRules } from './time-rules.repository.js';
import { reposDaysFor } from './weekly-payroll.repository.js';

/**
 * Parametrage et calcul de la paie mensuelle (mig 318) : bareme versionne,
 * reglages employeur, rubriques, elements fixes, cloture de periode, et
 * calcul + enregistrement d'un bulletin via le moteur pur payroll-engine.
 */

const pad = (n: number) => String(n).padStart(2, '0');
export function monthBounds(month: number, year: number): { start: string; end: string } {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-${pad(last)}` };
}

export interface PayrollContext {
  scale: TaxScale;
  baseDays: number;
  time: TimeRules;
}

// ─── Bareme ─────────────────────────────────────────────────────────────
export const taxScaleRepository = {
  /** Bareme en vigueur a une date : effective_from le plus recent <= date. */
  async findForDate(date: string) {
    const r = await db.query(
      `SELECT * FROM payroll_tax_scales
        WHERE effective_from <= $1::date AND (effective_to IS NULL OR effective_to >= $1::date)
        ORDER BY effective_from DESC LIMIT 1`,
      [date]
    );
    return r.rows[0] || null;
  },

  async list() {
    const r = await db.query('SELECT * FROM payroll_tax_scales ORDER BY effective_from DESC');
    return r.rows;
  },

  /**
   * Met a jour un bareme. Les bulletins payes gardent leurs montants
   * (snapshot) ; les non payes seront recalcules a la prochaine generation.
   */
  async update(id: string, data: Record<string, unknown>, userId?: string) {
    const mapping: Record<string, string> = {
      label: 'label', effectiveTo: 'effective_to',
      cnssPlafond: 'cnss_plafond', cnssRateEmployee: 'cnss_rate_employee', cnssRateEmployer: 'cnss_rate_employer',
      amoRateEmployee: 'amo_rate_employee', amoRateEmployer: 'amo_rate_employer',
      allocFamilialesRate: 'alloc_familiales_rate', taxeFpRate: 'taxe_fp_rate',
      fraisProRateBas: 'frais_pro_rate', fraisProRateHaut: 'frais_pro_rate_haut',
      fraisProSeuilAnnuel: 'frais_pro_seuil_annuel', fraisProPlafondAnnuel: 'frais_pro_plafond_annuel',
      deductionFamilleAnnuelle: 'deduction_famille_annuelle', maxPersonnesCharge: 'max_personnes_charge',
      irBrackets: 'ir_brackets', notes: 'notes',
    };
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, col] of Object.entries(mapping)) {
      if (data[key] === undefined) continue;
      fields.push(`${col} = $${i++}${col === 'ir_brackets' ? '::jsonb' : ''}`);
      values.push(col === 'ir_brackets' ? JSON.stringify(data[key]) : data[key]);
    }
    if (fields.length === 0) return null;
    fields.push(`updated_at = NOW()`, `updated_by = $${i++}`);
    values.push(userId ?? null, id);
    const r = await db.query(`UPDATE payroll_tax_scales SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return r.rows[0] || null;
  },
};

// ─── Reglages employeur ─────────────────────────────────────────────────
export const payrollSettingsRepository = {
  async get() {
    const r = await db.query('SELECT * FROM payroll_settings WHERE id = 1');
    return r.rows[0] || { employer_cnss_number: null, monthly_base_days: 26 };
  },
  async update(data: Record<string, unknown>, userId?: string) {
    // Champ absent = inchange. Conges (lot 2) et temps de travail (lot 3) inclus.
    const mapping: Record<string, string> = {
      employerCnssNumber: 'employer_cnss_number', monthlyBaseDays: 'monthly_base_days',
      leaveRestWeekday: 'leave_rest_weekday', leaveDaysPerMonth: 'leave_days_per_month',
      leaveCarryoverYears: 'leave_carryover_years',
      otRateDay: 'ot_rate_day', otRateNight: 'ot_rate_night', otRateRestDay: 'ot_rate_rest_day',
      otRateRestNight: 'ot_rate_rest_night', nightStart: 'night_start', nightEnd: 'night_end',
      monthlyLegalHours: 'monthly_legal_hours', weeklyLegalHours: 'weekly_legal_hours',
      holidayWorkedRate: 'holiday_worked_rate', otAnnualQuotaHours: 'ot_annual_quota_hours',
      // Virement groupe des salaires (mig 325).
      employerRib: 'employer_rib', employerBankName: 'employer_bank_name',
    };
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, col] of Object.entries(mapping)) {
      if (data[key] === undefined) continue;
      fields.push(`${col} = $${i++}`);
      values.push(data[key] === '' ? null : data[key]);
    }
    fields.push('updated_at = NOW()', `updated_by = $${i++}`);
    values.push(userId ?? null);
    const r = await db.query(`UPDATE payroll_settings SET ${fields.join(', ')} WHERE id = 1 RETURNING *`, values);
    return r.rows[0];
  },
};

// ─── Rubriques ──────────────────────────────────────────────────────────
export const rubriqueRepository = {
  async list(includeInactive = false) {
    const r = await db.query(
      `SELECT * FROM payroll_rubriques ${includeInactive ? '' : 'WHERE is_active = true'} ORDER BY kind, sort_order, label`
    );
    return r.rows;
  },
  async create(data: { code: string; label: string; kind: string; soumisCnss: boolean; soumisIr: boolean; plafondExonerationMensuel?: number | null; sortOrder?: number; notes?: string | null }) {
    const r = await db.query(
      `INSERT INTO payroll_rubriques (code, label, kind, soumis_cnss, soumis_ir, plafond_exoneration_mensuel, sort_order, notes)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,100),$8) RETURNING *`,
      [data.code.toUpperCase(), data.label, data.kind, data.soumisCnss, data.soumisIr,
       data.plafondExonerationMensuel ?? null, data.sortOrder ?? null, data.notes ?? null]
    );
    return r.rows[0];
  },
  /** Le code et le type restent figes : ils sont references par les bulletins. */
  async update(id: string, data: Record<string, unknown>) {
    const mapping: Record<string, string> = {
      label: 'label', soumisCnss: 'soumis_cnss', soumisIr: 'soumis_ir',
      plafondExonerationMensuel: 'plafond_exoneration_mensuel', isActive: 'is_active',
      sortOrder: 'sort_order', notes: 'notes',
    };
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, col] of Object.entries(mapping)) {
      if (data[key] !== undefined) { fields.push(`${col} = $${i++}`); values.push(data[key]); }
    }
    if (fields.length === 0) return null;
    values.push(id);
    const r = await db.query(`UPDATE payroll_rubriques SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return r.rows[0] || null;
  },
};

// ─── Elements fixes par employe ─────────────────────────────────────────
export const employeePayrollItemRepository = {
  async listByEmployee(employeeId: string) {
    const r = await db.query(
      `SELECT i.*, r.code AS rubrique_code, r.label AS rubrique_label, r.kind
         FROM employee_payroll_items i JOIN payroll_rubriques r ON r.id = i.rubrique_id
        WHERE i.employee_id = $1
        ORDER BY (i.end_date IS NULL OR i.end_date >= CURRENT_DATE) DESC, r.sort_order, i.start_date DESC`,
      [employeeId]
    );
    return r.rows;
  },
  async create(data: { employeeId: string; rubriqueId: string; amount: number; startDate?: string | null; endDate?: string | null; notes?: string | null }, userId?: string) {
    const r = await db.query(
      `INSERT INTO employee_payroll_items (employee_id, rubrique_id, amount, start_date, end_date, notes, created_by)
       VALUES ($1,$2,$3,COALESCE($4::date, CURRENT_DATE),$5,$6,$7) RETURNING *`,
      [data.employeeId, data.rubriqueId, data.amount, data.startDate || null, data.endDate || null, data.notes ?? null, userId ?? null]
    );
    return r.rows[0];
  },
  async findById(id: string) {
    const r = await db.query('SELECT * FROM employee_payroll_items WHERE id = $1', [id]);
    return r.rows[0] || null;
  },
  async update(id: string, data: { amount?: number; startDate?: string | null; endDate?: string | null; notes?: string | null }) {
    const r = await db.query(
      `UPDATE employee_payroll_items SET
         amount = COALESCE($1, amount),
         start_date = COALESCE($2::date, start_date),
         end_date = CASE WHEN $3::text = '__keep__' THEN end_date ELSE $4::date END,
         notes = COALESCE($5, notes)
       WHERE id = $6 RETURNING *`,
      [data.amount ?? null, data.startDate || null, data.endDate === undefined ? '__keep__' : 'set',
       data.endDate || null, data.notes ?? null, id]
    );
    return r.rows[0] || null;
  },
  async delete(id: string) {
    await db.query('DELETE FROM employee_payroll_items WHERE id = $1', [id]);
  },
};

// ─── Cloture de periode ─────────────────────────────────────────────────
export const payrollPeriodRepository = {
  async get(month: number, year: number) {
    const r = await db.query(
      `SELECT pp.*, u.first_name AS closed_by_first_name, u.last_name AS closed_by_last_name
         FROM payroll_periods pp LEFT JOIN users u ON u.id = pp.closed_by
        WHERE pp.year = $1 AND pp.month = $2`,
      [year, month]
    );
    return r.rows[0] || { year, month, status: 'open', closed_at: null, closed_by: null };
  },
  /** Leve une erreur si le mois est cloture (generation / edition interdites). */
  async assertOpen(month: number, year: number) {
    const r = await db.query(`SELECT status FROM payroll_periods WHERE year = $1 AND month = $2`, [year, month]);
    if (r.rows[0]?.status === 'closed') {
      throw new Error(`La paie de ${pad(month)}/${year} est clôturée : rouvrez la période pour la modifier.`);
    }
  },
  async close(month: number, year: number, userId?: string) {
    const r = await db.query(
      `INSERT INTO payroll_periods (year, month, status, closed_at, closed_by)
       VALUES ($1, $2, 'closed', NOW(), $3)
       ON CONFLICT (year, month) DO UPDATE SET status = 'closed', closed_at = NOW(), closed_by = EXCLUDED.closed_by
       RETURNING *`,
      [year, month, userId ?? null]
    );
    return r.rows[0];
  },
  async reopen(month: number, year: number) {
    const r = await db.query(
      `UPDATE payroll_periods SET status = 'open', closed_at = NULL, closed_by = NULL
        WHERE year = $1 AND month = $2 RETURNING *`,
      [year, month]
    );
    return r.rows[0] || { year, month, status: 'open' };
  },
};

// ─── Calcul et enregistrement d'un bulletin ─────────────────────────────
export async function loadPayrollContext(month: number, year: number): Promise<PayrollContext> {
  const { start } = monthBounds(month, year);
  const row = await taxScaleRepository.findForDate(start);
  if (!row) throw new Error(`Aucun barème de paie en vigueur au ${start} : ajoutez-le dans Paramètres de paie.`);
  const settings = await payrollSettingsRepository.get();
  return {
    scale: taxScaleFromRow(row),
    baseDays: parseInt(String(settings.monthly_base_days ?? 26), 10) || 26,
    time: await loadTimeRules(),
  };
}

type ManualLine = { rubriqueId: string; amount: number; label?: string | null };

function toRubriqueInput(r: Record<string, any>, amount: number, source: 'fixe' | 'manuel' | 'stc', label?: string | null): RubriqueInput {
  return {
    rubriqueId: r.id,
    label: label || r.label,
    kind: r.kind,
    amount,
    soumisCnss: r.soumis_cnss,
    soumisIr: r.soumis_ir,
    plafondExonerationMensuel: r.plafond_exoneration_mensuel === null ? null : parseFloat(r.plafond_exoneration_mensuel),
    source,
  };
}

/**
 * Calcule le bulletin d'un employe pour le mois et l'enregistre (upsert +
 * lignes), dans une transaction. Un bulletin deja PAYE n'est jamais touche :
 * on renvoie l'existant. `manual` remplace les lignes manuelles ; sinon on
 * conserve celles du bulletin existant.
 */
export async function computeAndSavePayslip(
  emp: Record<string, any>, month: number, year: number, ctx: PayrollContext, manual?: ManualLine[],
  /** Lignes du solde de tout compte (lot 6) : undefined = conserver, [] = retirer. */
  stc?: ManualLine[],
): Promise<Record<string, unknown>> {
  const { start, end } = monthBounds(month, year);

  // Pointage REEL uniquement (is_expected = false) : une ligne pre-remplie
  // par le planning ne compte pas. 'repos' couvre le jour (repos hebdo inclus
  // dans le mensuel) ; 'double' couvre 1 jour et en paie 1 de plus.
  const att = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('present', 'late', 'repos'))::int AS present_days,
       COUNT(*) FILTER (WHERE status = 'double')::int AS double_days,
       COUNT(*) FILTER (WHERE status = 'half_day')::int AS half_days,
       COALESCE(SUM(overtime_minutes), 0)::int AS total_overtime
      FROM attendance
     WHERE employee_id = $1 AND date BETWEEN $2 AND $3 AND is_expected = false`,
    [emp.id, start, end]
  );
  const a = att.rows[0];
  // Conges payes approuves (hors jours deja pointes) : jours couverts, pas d'absence retenue.
  const paidLeaveDays = await leaveBalanceRepository.paidLeaveDays(emp.id, start, end);
  // Heures sup ventilees (jour/nuit, ouvrable/repos) et jours feries : un
  // ferie non travaille est paye (couvert) ; travaille, il ouvre une indemnite.
  const tf = await periodTimeFacts(emp.id, start, end, ctx.time, emp.hire_date);
  const coveredDays = a.present_days + a.double_days + 0.5 * a.half_days + paidLeaveDays + tf.holidayPaid;

  // Elements fixes actifs sur le mois.
  const fixed = await db.query(
    `SELECT i.amount, r.*
       FROM employee_payroll_items i JOIN payroll_rubriques r ON r.id = i.rubrique_id
      WHERE i.employee_id = $1 AND r.is_active = true
        AND i.start_date <= $3::date AND (i.end_date IS NULL OR i.end_date >= $2::date)`,
    [emp.id, start, end]
  );

  // Lignes manuelles : celles fournies, sinon celles du bulletin existant.
  let manualInputs: RubriqueInput[];
  if (manual) {
    const ids = [...new Set(manual.map(m => m.rubriqueId))];
    const rubs = ids.length
      ? (await db.query('SELECT * FROM payroll_rubriques WHERE id = ANY($1::uuid[])', [ids])).rows
      : [];
    const byId = new Map(rubs.map((r: Record<string, any>) => [r.id, r]));
    manualInputs = manual.map(m => {
      const r = byId.get(m.rubriqueId);
      if (!r) throw new Error('Rubrique inconnue');
      return toRubriqueInput(r, m.amount, 'manuel', m.label);
    });
  } else {
    const existing = await db.query(
      `SELECT l.amount, l.label AS line_label, r.*
         FROM payroll_lines l
         JOIN payroll p ON p.id = l.payroll_id
         JOIN payroll_rubriques r ON r.id = l.rubrique_id
        WHERE p.employee_id = $1 AND p.month = $2 AND p.year = $3 AND l.source = 'manuel'`,
      [emp.id, month, year]
    );
    manualInputs = existing.rows.map((r: Record<string, any>) => toRubriqueInput(r, parseFloat(r.amount), 'manuel', r.line_label));
  }

  // Lignes du solde de tout compte : fournies, sinon celles du bulletin existant.
  let stcInputs: RubriqueInput[];
  if (stc) {
    const rubs = stc.length
      ? (await db.query('SELECT * FROM payroll_rubriques WHERE id = ANY($1::uuid[])', [[...new Set(stc.map(x => x.rubriqueId))]])).rows
      : [];
    const byId = new Map(rubs.map((r: Record<string, any>) => [r.id, r]));
    stcInputs = stc.map(x => toRubriqueInput(byId.get(x.rubriqueId) as Record<string, any>, x.amount, 'stc', x.label));
  } else {
    const existingStc = await db.query(
      `SELECT l.amount, l.label AS line_label, r.*
         FROM payroll_lines l JOIN payroll p ON p.id = l.payroll_id JOIN payroll_rubriques r ON r.id = l.rubrique_id
        WHERE p.employee_id = $1 AND p.month = $2 AND p.year = $3 AND l.source = 'stc'`,
      [emp.id, month, year]
    );
    stcInputs = existingStc.rows.map((r: Record<string, any>) => toRubriqueInput(r, parseFloat(r.amount), 'stc', r.line_label));
  }

  const years = serviceYears(emp.hire_date ? String(emp.hire_date instanceof Date ? isoOf(emp.hire_date) : emp.hire_date) : null, end)
    ?? (parseInt(emp.seniority_years, 10) || 0);

  // Regularisation annuelle de l'IR : bulletin de decembre, ou dernier
  // bulletin du salarie (sortie dans le mois, ou solde de tout compte porte).
  const exitIso = emp.exit_date ? (emp.exit_date instanceof Date ? isoOf(emp.exit_date) : String(emp.exit_date).slice(0, 10)) : null;
  const isLastPayslip = month === 12 || (exitIso !== null && exitIso >= start && exitIso <= end) || stcInputs.length > 0;
  let irCumul: IrCumul | undefined;
  if (isLastPayslip && emp.is_declared !== false) {
    const c = (await db.query(
      `SELECT COUNT(*)::int AS months,
              COALESCE(SUM(COALESCE(brut_imposable, gross_salary)), 0) AS brut_imposable,
              COALESCE(SUM(COALESCE(cnss_employee, 0) + COALESCE(amo_employee, 0) + COALESCE(cimr_employee, 0)), 0) AS cotisations,
              COALESCE(SUM(ir_net), 0) AS ir
         FROM payroll
        WHERE employee_id = $1 AND year = $2 AND month < $3 AND COALESCE(is_declared, true) = true`,
      [emp.id, year, month]
    )).rows[0];
    irCumul = {
      months: c.months, brutImposable: parseFloat(c.brut_imposable),
      cotisations: parseFloat(c.cotisations), irWithheld: parseFloat(c.ir),
    };
  }

  // Salarie hebdo / quinzaine declare (mig 327) : brut = paies periodiques
  // rattachees au mois ; acomptes = leurs nets deja verses.
  const periodicFreq = emp.pay_frequency === 'weekly' || emp.pay_frequency === 'biweekly' ? emp.pay_frequency as 'weekly' | 'biweekly' : null;
  const periodicMonth = periodicFreq ? await loadPeriodicMonth(emp.id, periodicFreq, start, end) : null;

  const r = computeMonthlyPayslip({
    periodic: periodicMonth?.gross,
    monthlySalary: parseFloat(emp.monthly_salary ?? 0) || 0,
    baseDays: ctx.baseDays,
    coveredDays,
    doubleDays: a.double_days,
    overtimeHours: a.total_overtime / 60,
    seniorityYears: years,
    nbDependents: parseInt(emp.nb_dependents, 10) || 0,
    cimrRate: parseFloat(emp.cimr_rate) || 0,
    isDeclared: emp.is_declared !== false,
    overtime: tf.overtime,
    otRates: ctx.time.otRates,
    legalMonthlyHours: ctx.time.monthlyLegalHours,
    holidayWorkedDays: tf.holidayWorked,
    holidayWorkedRate: ctx.time.holidayWorkedRate,
    irRegularisation: irCumul,
    lines: [
      ...fixed.rows.map((f: Record<string, any>) => toRubriqueInput(f, parseFloat(f.amount), 'fixe')),
      ...manualInputs,
      ...stcInputs,
    ],
  }, ctx.scale);

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const up = await client.query(
      `INSERT INTO payroll (
         employee_id, month, year, base_salary, worked_days, absent_days,
         overtime_hours, overtime_amount, seniority_bonus, seniority_rate, bonuses, gross_salary, deductions,
         other_deductions, cnss_employee, cnss_employer, amo_employee, amo_employer,
         cimr_employee, cimr_employer, frais_pro, ir_gross, ir_net, family_deduction, nb_dependents,
         alloc_familiales, taxe_fp, total_charges_patron, net_salary,
         extra_shift_days, extra_shift_amount,
         tax_scale_id, is_declared, base_cnss, brut_imposable, net_imposable, paid_leave_days,
         ot_day_hours, ot_night_hours, ot_rest_day_hours, ot_rest_night_hours,
         holiday_paid_days, holiday_worked_days, holiday_premium, ir_regularisation,
         pay_frequency, acomptes_amount
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47)
       ON CONFLICT (employee_id, month, year) DO UPDATE SET
         base_salary = EXCLUDED.base_salary, worked_days = EXCLUDED.worked_days,
         absent_days = EXCLUDED.absent_days, overtime_hours = EXCLUDED.overtime_hours,
         overtime_amount = EXCLUDED.overtime_amount, seniority_bonus = EXCLUDED.seniority_bonus,
         seniority_rate = EXCLUDED.seniority_rate, bonuses = EXCLUDED.bonuses,
         gross_salary = EXCLUDED.gross_salary, deductions = EXCLUDED.deductions,
         other_deductions = EXCLUDED.other_deductions,
         cnss_employee = EXCLUDED.cnss_employee, cnss_employer = EXCLUDED.cnss_employer,
         amo_employee = EXCLUDED.amo_employee, amo_employer = EXCLUDED.amo_employer,
         cimr_employee = EXCLUDED.cimr_employee, cimr_employer = EXCLUDED.cimr_employer,
         frais_pro = EXCLUDED.frais_pro, ir_gross = EXCLUDED.ir_gross,
         ir_net = EXCLUDED.ir_net, family_deduction = EXCLUDED.family_deduction,
         nb_dependents = EXCLUDED.nb_dependents,
         alloc_familiales = EXCLUDED.alloc_familiales, taxe_fp = EXCLUDED.taxe_fp,
         total_charges_patron = EXCLUDED.total_charges_patron,
         net_salary = EXCLUDED.net_salary,
         extra_shift_days = EXCLUDED.extra_shift_days,
         extra_shift_amount = EXCLUDED.extra_shift_amount,
         tax_scale_id = EXCLUDED.tax_scale_id, is_declared = EXCLUDED.is_declared,
         base_cnss = EXCLUDED.base_cnss, brut_imposable = EXCLUDED.brut_imposable,
         net_imposable = EXCLUDED.net_imposable, paid_leave_days = EXCLUDED.paid_leave_days,
         ot_day_hours = EXCLUDED.ot_day_hours, ot_night_hours = EXCLUDED.ot_night_hours,
         ot_rest_day_hours = EXCLUDED.ot_rest_day_hours, ot_rest_night_hours = EXCLUDED.ot_rest_night_hours,
         holiday_paid_days = EXCLUDED.holiday_paid_days, holiday_worked_days = EXCLUDED.holiday_worked_days,
         holiday_premium = EXCLUDED.holiday_premium,
         ir_regularisation = EXCLUDED.ir_regularisation,
         pay_frequency = EXCLUDED.pay_frequency, acomptes_amount = EXCLUDED.acomptes_amount
       WHERE payroll.paid = false
       RETURNING *`,
      [emp.id, month, year, r.baseSalary, r.workedDays, r.absentDays,
       a.total_overtime / 60, r.overtimeAmount, r.seniorityBonus, r.seniorityRate, r.gainsTotal,
       r.grossSalary, r.absenceDeduction, r.retenuesTotal,
       r.cnssEmployee, r.cnssEmployer, r.amoEmployee, r.amoEmployer,
       r.cimrEmployee, r.cimrEmployer, r.fraisPro, r.irGross, r.irNet, r.familyDeduction,
       Math.min(parseInt(emp.nb_dependents, 10) || 0, ctx.scale.maxPersonnesCharge),
       r.allocFamiliales, r.taxeFp, r.totalChargesPatron, r.netSalary,
       a.double_days, r.extraShiftAmount,
       ctx.scale.id ?? null, emp.is_declared !== false, r.baseCnss, r.brutImposable, r.netImposable, paidLeaveDays,
       tf.overtime.day, tf.overtime.night, tf.overtime.restDay, tf.overtime.restNight,
       tf.holidayPaid, tf.holidayWorked, r.holidayPremium, r.irRegularisation,
       periodicFreq ?? 'monthly', periodicMonth?.acomptes ?? 0]
    );

    if (!up.rows[0]) {
      // Bulletin deja paye : la garde WHERE l'a laisse intact (le net a servi
      // a une sortie de caisse) — on renvoie la ligne existante.
      await client.query('ROLLBACK');
      const existing = await db.query(
        'SELECT * FROM payroll WHERE employee_id = $1 AND month = $2 AND year = $3',
        [emp.id, month, year]
      );
      return existing.rows[0];
    }

    const payroll = up.rows[0];
    await client.query('DELETE FROM payroll_lines WHERE payroll_id = $1', [payroll.id]);
    for (const l of r.lines) {
      if (!(l.amount > 0)) continue;
      await client.query(
        `INSERT INTO payroll_lines (payroll_id, rubrique_id, label, kind, amount, exempt_amount, cnss_amount, ir_amount, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [payroll.id, l.rubriqueId, l.label, l.kind, l.amount, l.exemptAmount, l.cnssAmount, l.irAmount, l.source]
      );
    }
    await client.query('COMMIT');
    return payroll;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Paies periodiques rattachees au mois (semaine : celle dont le jeudi tombe
 * dans le mois ; quinzaine : celles du mois). `acomptes` = nets PAYES ;
 * `unpaid` = periodes encore a payer (le bulletin ne se paie qu'apres elles).
 * `withheld` = periodes calculees en acompte (retenue provisoire > 0) : sans
 * elles, le mois releve de l'ancien modele (paye sans retenue) et n'a pas de
 * bulletin mensuel.
 */
export async function loadPeriodicMonth(
  employeeId: string, frequency: 'weekly' | 'biweekly', start: string, end: string,
): Promise<{ gross: PeriodicGross; acomptes: number; unpaid: number; periods: number; withheld: number }> {
  const sql = frequency === 'weekly'
    ? `SELECT * FROM weekly_payroll WHERE employee_id = $1 AND (week_start + 3) BETWEEN $2::date AND $3::date`
    : `SELECT * FROM biweekly_payroll WHERE employee_id = $1 AND period_start BETWEEN $2::date AND $3::date`;
  const rows = (await db.query(sql, [employeeId, start, end])).rows;
  const n = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
  const gross: PeriodicGross = { base: 0, overtime: 0, holiday: 0, paidDays: 0 };
  let acomptes = 0;
  let unpaid = 0;
  let withheld = 0;
  for (const w of rows) {
    if (n(w.withholding_amount) > 0) withheld++;
    gross.base += n(w.base_amount);
    gross.overtime += n(w.overtime_amount);
    gross.holiday += n(w.holiday_premium);
    // Hebdo : repos paye en plus des jours travailles (regle reposDaysFor).
    gross.paidDays += n(w.worked_days) + (frequency === 'weekly' ? reposDaysFor(n(w.worked_days)) : 0);
    if (w.paid) acomptes += n(w.net_amount); else unpaid++;
  }
  return { gross, acomptes: Math.round(acomptes * 100) / 100, unpaid, periods: rows.length, withheld };
}

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
