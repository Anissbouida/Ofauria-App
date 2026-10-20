import { db } from '../config/database.js';
import { computeSettlement, EXIT_REASON_LABELS, type ExitReason, type SettlementResult } from '../services/final-settlement.js';
import { leaveBalanceRepository } from './leave.repository.js';
import { payrollPeriodRepository, loadPayrollContext, computeAndSavePayslip } from './payroll-config.repository.js';
import { paymentRepository } from './accounting.repository.js';
import { cancelPayrollPayment } from '../services/payroll-ledger.service.js';

/**
 * Solde de tout compte (lot 6, mig 323).
 *  - Salarie paye au mois : les montants deviennent des lignes « stc » du
 *    bulletin du mois de depart (cotisations, IR, retenue d'avances et
 *    comptabilite suivent le circuit normal de la paie).
 *  - Hebdo / quinzaine (non declares) : paiement direct du net.
 * Valider cloture le contrat et sort l'employe des effectifs ; annuler
 * (tant que rien n'est paye) remet tout en l'etat.
 */

type Row = Record<string, any>;
const iso = (d: unknown): string | null => {
  if (!d) return null;
  if (d instanceof Date) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return String(d).slice(0, 10);
};
const httpError = (status: number, message: string) => Object.assign(new Error(message), { statusCode: status });

export interface SettlementRequest {
  exitDate: string;
  reason: ExitReason;
  noticeWorked: boolean;
  damagesMonths?: number;
  notes?: string | null;
  /** Hebdo / quinzaine : mode de paiement du net. */
  paymentMethod?: string;
}

async function context(employeeId: string, req: SettlementRequest) {
  const emp = (await db.query('SELECT * FROM employees WHERE id = $1', [employeeId])).rows[0];
  if (!emp) throw httpError(404, 'Employé introuvable');
  if (!emp.hire_date) throw httpError(400, 'Date d\'embauche manquante.');
  if (req.exitDate < iso(emp.hire_date)!) throw httpError(400, 'La date de sortie précède l\'embauche.');
  const contract = (await db.query(
    `SELECT * FROM employee_contracts WHERE employee_id = $1 ORDER BY (status = 'active') DESC, start_date DESC LIMIT 1`, [employeeId]
  )).rows[0] ?? null;
  const [y, m] = req.exitDate.split('-').map(Number);
  // Salaire moyen de reference : 12 derniers bulletins mensuels avant le mois de sortie.
  const avg = (await db.query(
    `SELECT AVG(gross_salary) AS avg, COUNT(*)::int AS n FROM (
       SELECT gross_salary FROM payroll WHERE employee_id = $1 AND (year * 12 + month) < $2
        ORDER BY year DESC, month DESC LIMIT 12) t`,
    [employeeId, y * 12 + m]
  )).rows[0];
  const settings = (await db.query('SELECT * FROM payroll_settings WHERE id = 1')).rows[0] ?? {};
  const balance = await leaveBalanceRepository.forEmployee(employeeId, req.exitDate);
  const frequency = emp.pay_frequency ?? 'monthly';
  // Salaire mensuel de reference d'un hebdo : salaire hebdo x 52 / 12.
  const monthlySalary = frequency === 'weekly'
    ? parseFloat(emp.weekly_salary ?? '0') * 52 / 12
    : parseFloat(emp.monthly_salary ?? contract?.monthly_salary ?? '0');
  const result = computeSettlement({
    reason: req.reason,
    contractType: contract?.contract_type ?? emp.contract_type ?? 'cdi',
    category: contract?.category ?? 'employe',
    hireDate: iso(emp.hire_date)!,
    exitDate: req.exitDate,
    monthlySalary,
    averageMonthlyGross: avg?.n >= 3 ? parseFloat(avg.avg) : 0,
    legalMonthlyHours: parseFloat(settings.monthly_legal_hours ?? '191'),
    baseDays: settings.monthly_base_days ?? 26,
    leaveBalanceDays: balance?.available ?? 0,
    noticeWorked: req.noticeWorked,
    damagesMonths: req.damagesMonths ?? 0,
  });
  return { emp, contract, result, frequency, month: m, year: y, referenceMonths: avg?.n ?? 0 };
}

export const finalSettlementRepository = {
  async preview(employeeId: string, req: SettlementRequest) {
    const c = await context(employeeId, req);
    return { ...c.result, payFrequency: c.frequency, referenceMonths: c.referenceMonths, reasonLabel: EXIT_REASON_LABELS[req.reason] };
  },

  async list(employeeId: string) {
    const r = await db.query(
      `SELECT s.*, s.exit_date::text AS exit_date, p.paid AS payroll_paid, p.net_salary AS payroll_net, p.month, p.year
         FROM final_settlements s LEFT JOIN payroll p ON p.id = s.payroll_id
        WHERE s.employee_id = $1 ORDER BY s.created_at DESC`,
      [employeeId]
    );
    return r.rows;
  },

  async validate(employeeId: string, req: SettlementRequest, userId: string) {
    const existing = await db.query(`SELECT 1 FROM final_settlements WHERE employee_id = $1 AND status = 'validated'`, [employeeId]);
    if (existing.rowCount) throw httpError(409, 'Un solde de tout compte est déjà validé pour cet employé : annulez-le d\'abord.');
    const c = await context(employeeId, req);
    const r: SettlementResult = c.result;
    let payrollId: string | null = null;
    let paymentId: string | null = null;

    if (c.frequency === 'monthly') {
      await payrollPeriodRepository.assertOpen(c.month, c.year);
      const cur = (await db.query('SELECT paid FROM payroll WHERE employee_id = $1 AND month = $2 AND year = $3', [employeeId, c.month, c.year])).rows[0];
      if (cur?.paid) throw httpError(409, `Le bulletin de ${String(c.month).padStart(2, '0')}/${c.year} est déjà payé : annulez son paiement pour y ajouter le solde de tout compte.`);
      const rubs = (await db.query(`SELECT id, code FROM payroll_rubriques WHERE code = ANY($1::text[])`, [r.lines.map(l => l.code)])).rows;
      const byCode = new Map(rubs.map((x: Row) => [x.code, x.id]));
      const ctx = await loadPayrollContext(c.month, c.year);
      const payroll = await computeAndSavePayslip(c.emp, c.month, c.year, ctx, undefined,
        r.lines.map(l => ({ rubriqueId: byCode.get(l.code) as string, amount: l.amount, label: `${l.label} (${l.detail})`.slice(0, 120) })));
      payrollId = payroll.id as string;
    } else {
      const net = Math.round((r.totalGains - r.totalDeductions) * 100) / 100;
      if (net > 0) {
        const p = await paymentRepository.create({
          reference: `STC-${req.exitDate}-${String(c.emp.last_name).replace(/\s+/g, '')}`.slice(0, 50),
          type: 'salary', employeeId, amount: net, paymentMethod: req.paymentMethod ?? 'cash', paymentDate: req.exitDate,
          description: `Solde de tout compte ${c.emp.first_name} ${c.emp.last_name}`,
          createdBy: userId, storeId: c.emp.store_id ?? undefined,
          categoryId: (await db.query(`SELECT id FROM expense_categories WHERE name = 'Salaires' LIMIT 1`)).rows[0]?.id ?? null,
        } as Parameters<typeof paymentRepository.create>[0]);
        paymentId = p.id;
      }
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const active = (await client.query(`SELECT * FROM employee_contracts WHERE employee_id = $1 AND status = 'active' FOR UPDATE`, [employeeId])).rows[0];
      const computation = {
        ...r, payFrequency: c.frequency, referenceMonths: c.referenceMonths, paymentId,
        previousContract: active ? { id: active.id, endDate: iso(active.end_date) } : null,
        previousEmployee: { contractEnd: iso(c.emp.contract_end), isActive: c.emp.is_active },
      };
      const ins = await client.query(
        `INSERT INTO final_settlements (employee_id, contract_id, exit_date, reason, notice_worked, computation,
           leave_indemnity, notice_indemnity, severance_indemnity, damages, deductions, payroll_id, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [employeeId, active?.id ?? c.contract?.id ?? null, req.exitDate, req.reason, req.noticeWorked, JSON.stringify(computation),
         r.leave.days > 0 ? r.leave.amount : 0, r.notice.due ? r.notice.amount : 0, r.severance.amount, r.damages.amount,
         r.totalDeductions, payrollId, req.notes ?? null, userId]
      );
      if (active) {
        await client.query(`UPDATE employee_contracts SET status = 'ended', end_date = $2, end_reason = $3 WHERE id = $1`,
          [active.id, req.exitDate, EXIT_REASON_LABELS[req.reason]]);
      }
      await client.query(
        `UPDATE employees SET exit_date = $2, exit_reason = $3, contract_end = $2, is_active = false, updated_by = $4 WHERE id = $1`,
        [employeeId, req.exitDate, req.reason, userId]
      );
      await client.query('COMMIT');
      return ins.rows[0];
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      // Remise en l'etat : retire les lignes du bulletin ou annule le paiement direct.
      try {
        if (payrollId) await computeAndSavePayslip(c.emp, c.month, c.year, await loadPayrollContext(c.month, c.year), undefined, []);
        if (paymentId) await cancelPayrollPayment(paymentId, userId, 'Échec de la validation du solde de tout compte');
      } catch (cleanupErr) {
        // eslint-disable-next-line no-console
        console.error('[final-settlement.validate] remise en etat incomplete', cleanupErr);
      }
      throw err;
    } finally {
      client.release();
    }
  },

  /** Annulation tant que le dernier bulletin n'est pas paye : tout revient en l'etat. */
  async cancel(id: string, userId: string) {
    const s = (await db.query(`SELECT * FROM final_settlements WHERE id = $1`, [id])).rows[0];
    if (!s || s.status !== 'validated') throw httpError(404, 'Solde de tout compte introuvable ou déjà annulé.');
    const comp = s.computation ?? {};
    if (s.payroll_id) {
      const p = (await db.query('SELECT * FROM payroll WHERE id = $1', [s.payroll_id])).rows[0];
      if (p?.paid) throw httpError(409, 'Le dernier bulletin est payé : annulez d\'abord son paiement.');
      if (p) {
        await payrollPeriodRepository.assertOpen(p.month, p.year);
        const emp = (await db.query('SELECT * FROM employees WHERE id = $1', [s.employee_id])).rows[0];
        const ctx = await loadPayrollContext(p.month, p.year);
        await computeAndSavePayslip(emp, p.month, p.year, ctx, undefined, []);
      }
    }
    if (comp.paymentId) await cancelPayrollPayment(comp.paymentId, userId, 'Annulation du solde de tout compte');

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE final_settlements SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $2 WHERE id = $1`, [id, userId]);
      if (comp.previousContract?.id) {
        await client.query(`UPDATE employee_contracts SET status = 'active', end_date = $2, end_reason = NULL WHERE id = $1`,
          [comp.previousContract.id, comp.previousContract.endDate]);
      }
      await client.query(
        `UPDATE employees SET exit_date = NULL, exit_reason = NULL, contract_end = $2, is_active = $3, updated_by = $4 WHERE id = $1`,
        [s.employee_id, comp.previousEmployee?.contractEnd ?? null, comp.previousEmployee?.isActive ?? true, userId]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  },
};
