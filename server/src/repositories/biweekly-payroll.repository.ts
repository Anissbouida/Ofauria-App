import { db } from '../config/database.js';
import { paymentRepository } from './accounting.repository.js';
import { cancelPayrollPayment } from '../services/payroll-ledger.service.js';
import { leaveBalanceRepository, loadLeaveConfig } from './leave.repository.js';
import { loadTimeRules, periodTimeFacts } from './time-rules.repository.js';
import { overtimeAmount as otAmount } from '../services/overtime-engine.js';
import { salaryAdvanceRepository } from './salary-advance.repository.js';
import { getLocalISODate } from '../utils/timezone.js';
import { loadPayrollContext } from './payroll-config.repository.js';
import { provisionalWithholding, periodMonth } from '../services/payroll-engine.js';

/**
 * Paie par quinzaine (biweekly).
 *
 * Modele calque sur weekly-payroll.repository.ts : 1 ligne par employe x
 * quinzaine CALENDAIRE (1-15 ou 16-fin de mois). Le manager declenche la
 * generation pour une quinzaine de reference, le systeme calcule le net a
 * payer depuis le pointage, puis il coche les employes au fur et a mesure
 * des paiements.
 *
 * Convention salaire (regle metier validee 07/2026) :
 *   La base reste le salaire MENSUEL de l'employe (employees.monthly_salary,
 *   pas de champ dedie) :
 *     dailyRate = monthly_salary / 26   (convention marocaine : 26 jours
 *                                        travailles = mois complet)
 *   PAS de repos hebdomadaire paye automatiquement (difference majeure avec
 *   la paie hebdo) : on paie UNIQUEMENT les jours pointes. Les jours pointes
 *   'repos' ne sont donc pas comptes.
 *   baseAmount = dailyRate x workedDays
 *   overtimeHours = SUM(attendance.overtime_minutes) / 60
 *   overtimeAmount = heures sup ventilees x (salaire mensuel / 191 h) x (1 + 25/50/100 %) (lot 3)
 *   netAmount = baseAmount + overtimeAmount
 *
 * Salarie declare (mig 327) : la ligne est un ACOMPTE. net_amount = brut
 * (gross_amount) - retenue provisoire (withholding_amount) ; le bulletin
 * mensuel (payroll) calcule CNSS / AMO / IR exacts et deduit les acomptes.
 * Non declare : pas de retenue, net = brut.
 */

/** cf. weekly-payroll.repository.ts : formatage DATE pg -> 'YYYY-MM-DD' local. */
function toDateStr(v: unknown): string {
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 10);
}

export const biweeklyPayrollRepository = {
  /**
   * Liste enrichie : employes biweekly + leur ligne sur la quinzaine (ou
   * null si pas encore generee).
   */
  async list(periodStart: string, _periodEnd: string, storeId?: string) {
    const result = await db.query(
      `SELECT
         e.id              AS employee_id,
         e.first_name,
         e.last_name,
         e.role,
         e.monthly_salary,
         e.default_shift_code,
         bp.id             AS payroll_id,
         bp.base_amount,
         bp.worked_days,
         bp.absent_days,
         bp.overtime_hours,
         bp.overtime_amount,
         bp.net_amount,
         bp.gross_amount,
         bp.withholding_amount,
         e.is_declared,
         bp.advance_deduction,
         bp.paid,
         bp.paid_at,
         bp.payment_method,
         bp.notes
       FROM employees e
       LEFT JOIN biweekly_payroll bp
         ON bp.employee_id = e.id
        AND bp.period_start = $1::date
       WHERE e.is_active = true
         AND e.pay_frequency = 'biweekly'
         ${storeId ? 'AND (e.store_id = $2 OR e.store_id IS NULL)' : ''}
       ORDER BY e.last_name, e.first_name`,
      storeId ? [periodStart, storeId] : [periodStart]
    );
    return result.rows;
  },

  /**
   * Genere (upsert) les lignes pour tous les employes biweekly de la
   * quinzaine. Calcul depuis attendance + employees.monthly_salary / 26.
   * Conserve les flags `paid` deja positionnes (on ne reset jamais un
   * paiement valide).
   */
  async generate(periodStart: string, periodEnd: string, storeId?: string) {
    const storeFilter = storeId ? 'AND (e.store_id = $1 OR e.store_id IS NULL)' : '';
    const employeesRes = await db.query(
      `SELECT e.id, e.monthly_salary, e.hire_date, e.is_declared, e.nb_dependents, e.cimr_rate
         FROM employees e
        WHERE e.is_active = true
          AND e.pay_frequency = 'biweekly'
          AND e.monthly_salary IS NOT NULL
          ${storeFilter}`,
      storeId ? [storeId] : []
    );

    const r2 = (v: number) => Math.round(v * 100) / 100;
    const results: Array<Record<string, unknown>> = [];

    const leaveCfg = await loadLeaveConfig();
    const timeRules = await loadTimeRules();
    // Bareme du mois de rattachement : la retenue provisoire des declares (mig 327).
    const pm = periodMonth(periodStart, 'biweekly');
    let scale: Awaited<ReturnType<typeof loadPayrollContext>>['scale'] | null = null;
    if (employeesRes.rows.some((e: Record<string, unknown>) => e.is_declared !== false)) {
      scale = (await loadPayrollContext(pm.month, pm.year)).scale;
    }
    for (const emp of employeesRes.rows) {
      const monthlySalary = parseFloat(emp.monthly_salary as string);
      const dailyRate = monthlySalary / 26;

      const att = await db.query(
        // 'repos' est EXCLU : la quinzaine paie UNIQUEMENT les jours
        // travailles (pas de repos paye automatique, regle metier 07/2026).
        // 'double' = deux shifts le meme jour -> compte 2 jours payes.
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('present', 'late'))::int AS present_days,
           COUNT(*) FILTER (WHERE status = 'double')::int             AS double_days,
           COUNT(*) FILTER (WHERE status = 'absent')::int             AS absent_days,
           COUNT(*) FILTER (WHERE status = 'half_day')::int           AS half_days,
           COALESCE(SUM(overtime_minutes), 0)::int                    AS total_overtime_min
         FROM attendance
         WHERE employee_id = $1
           AND date BETWEEN $2 AND $3
           AND is_expected = false`,
        [emp.id, periodStart, periodEnd]
      );
      const a = att.rows[0];
      // Conges payes approuves (hors jours pointes) : comptes comme travailles.
      const paidLeaveDays = await leaveBalanceRepository.paidLeaveDays(emp.id, periodStart, periodEnd, leaveCfg);
      // Demi-journee = 0.5 jour paye.
      // Feries (lot 3) : non travaille = jour paye ; travaille = indemnite.
      const tf = await periodTimeFacts(emp.id, periodStart, periodEnd, timeRules, emp.hire_date);
      const workedDays = a.present_days + 2 * a.double_days + 0.5 * a.half_days + paidLeaveDays + tf.holidayPaid;
      const absentDays = a.absent_days;
      const overtimeHours = a.total_overtime_min / 60;
      const baseAmount = r2(dailyRate * workedDays);
      // Heures sup majorees (25/50/100 %) au taux horaire legal.
      const overtimeAmount = otAmount(tf.overtime, monthlySalary / timeRules.monthlyLegalHours, timeRules.otRates);
      const holidayPremium = r2(tf.holidayWorked * dailyRate * timeRules.holidayWorkedRate);
      const grossAmount = r2(baseAmount + overtimeAmount + holidayPremium);
      // Declare : acompte = brut - retenue provisoire (CNSS, AMO, CIMR, IR) ;
      // le bulletin du mois regularise au centime pres.
      const withholding = emp.is_declared !== false && scale
        ? provisionalWithholding(grossAmount, 'biweekly', {
            nbDependents: parseInt(String(emp.nb_dependents ?? 0), 10) || 0,
            cimrRate: parseFloat(String(emp.cimr_rate ?? 0)) || 0,
          }, scale)
        : 0;
      const netAmount = r2(grossAmount - withholding);

      const r = await db.query(
        `INSERT INTO biweekly_payroll
           (employee_id, period_start, period_end, base_amount, worked_days, absent_days,
            overtime_hours, overtime_amount, net_amount, paid_leave_days,
            holiday_paid_days, holiday_worked_days, holiday_premium, gross_amount, withholding_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (employee_id, period_start) DO UPDATE SET
           period_end = EXCLUDED.period_end,
           base_amount = EXCLUDED.base_amount,
           worked_days = EXCLUDED.worked_days,
           absent_days = EXCLUDED.absent_days,
           overtime_hours = EXCLUDED.overtime_hours,
           overtime_amount = EXCLUDED.overtime_amount,
           paid_leave_days = EXCLUDED.paid_leave_days,
           holiday_paid_days = EXCLUDED.holiday_paid_days,
           holiday_worked_days = EXCLUDED.holiday_worked_days,
           holiday_premium = EXCLUDED.holiday_premium,
           gross_amount = EXCLUDED.gross_amount,
           withholding_amount = EXCLUDED.withholding_amount,
           net_amount = EXCLUDED.net_amount
         -- Ligne payee : intouchable (jours, base et net ont servi a la sortie de
         -- caisse). Avant, seul le net etait garde et les jours/base changeaient.
         WHERE biweekly_payroll.paid = false
         RETURNING *`,
        [emp.id, periodStart, periodEnd, baseAmount, workedDays, absentDays, overtimeHours, overtimeAmount, netAmount, paidLeaveDays,
         tf.holidayPaid, tf.holidayWorked, holidayPremium, grossAmount, withholding]
      );
      if (r.rows[0]) results.push(r.rows[0]);
      else {
        const existing = await db.query('SELECT * FROM biweekly_payroll WHERE employee_id = $1 AND period_start = $2', [emp.id, periodStart]);
        if (existing.rows[0]) results.push(existing.rows[0]);
      }
    }
    return results;
  },

  async findById(id: string) {
    const r = await db.query('SELECT * FROM biweekly_payroll WHERE id = $1', [id]);
    return r.rows[0] || null;
  },

  /**
   * Marque comme paye + cree l'ecriture comptable (type 'salary').
   * Idempotent : si deja paye, retourne la ligne sans recreer l'ecriture.
   * Meme mecanique que weekly-payroll.repository.ts:markPaid (verrou
   * atomique + rollback complet si la sortie de caisse echoue).
   */
  async markPaid(id: string, paymentMethod: string, createdBy?: string, storeId?: string, advanceDeduction = 0) {
    const existing = await db.query('SELECT * FROM biweekly_payroll WHERE id = $1', [id]);
    const row = existing.rows[0];
    if (!row) return null;
    if (row.paid) return row;

    const net = parseFloat(row.net_amount as string);
    const deduction = Math.max(0, Math.round((advanceDeduction || 0) * 100) / 100);
    if (deduction > 0) {
      const outstandingRes = await salaryAdvanceRepository.outstandingByEmployee(row.employee_id as string);
      const outstanding = parseFloat(outstandingRes[0]?.outstanding || '0');
      if (deduction > Math.min(net, outstanding) + 0.005) {
        throw new Error(`Retenue ${deduction.toFixed(2)} DH superieure au net a payer (${net.toFixed(2)} DH) ou au solde d'avances (${outstanding.toFixed(2)} DH)`);
      }
    }

    const claim = await db.query(
      `UPDATE biweekly_payroll SET paid = true, paid_at = NOW(), payment_method = $1,
                                   advance_deduction = $2, paid_by = $3, updated_by = $3
         WHERE id = $4 AND paid = false RETURNING *`,
      [paymentMethod, deduction, createdBy || null, id]
    );
    if (claim.rowCount === 0) {
      const now = await db.query('SELECT * FROM biweekly_payroll WHERE id = $1', [id]);
      return now.rows[0] || null;
    }
    const bp = claim.rows[0];

    const emp = await db.query('SELECT first_name, last_name FROM employees WHERE id = $1', [bp.employee_id]);
    const empName = emp.rows[0] ? `${emp.rows[0].first_name} ${emp.rows[0].last_name}` : '';

    const catResult = await db.query(`SELECT id FROM expense_categories WHERE name = 'Salaires' AND type = 'expense' LIMIT 1`);
    const categoryId = catResult.rows[0]?.id || null;

    // Decaissement reel = net moins la retenue (le cash de l'avance est deja
    // sorti a l'octroi). Rollback complet en cas d'echec.
    let createdPaymentId: string | null = null;
    try {
      const periodStartStr = toDateStr(bp.period_start);
      const periodEndStr = toDateStr(bp.period_end);
      const cashOut = Math.round((net - deduction) * 100) / 100;
      if (cashOut > 0) {
        const payment = await paymentRepository.create({
          // reference VARCHAR(50) : prefixe SAL-Q (quinzaine), tronque.
          reference: `SAL-Q${periodStartStr}-${empName.replace(/\s+/g, '')}`.slice(0, 50),
          type: 'salary',
          categoryId,
          employeeId: bp.employee_id,
          amount: cashOut,
          paymentMethod,
          paymentDate: getLocalISODate(),
          description: `Salaire quinzaine du ${periodStartStr} au ${periodEndStr} - ${empName}`
            + (deduction > 0 ? ` (retenue avance ${deduction.toFixed(2)} DH)` : ''),
          createdBy: createdBy || bp.employee_id,
          storeId,
        });
        createdPaymentId = payment?.id ?? null;
      }

      if (deduction > 0) {
        const applied = await salaryAdvanceRepository.applyDeduction({
          employeeId: bp.employee_id as string,
          amount: deduction,
          biweeklyPayrollId: id,
          userId: createdBy || (bp.employee_id as string),
          storeId,
          label: `${empName} quinzaine du ${periodStartStr}`,
        });
        if (Math.abs(applied - deduction) > 0.005) {
          throw new Error(
            `Retenue partielle : ${applied.toFixed(2)} DH imputes sur ${deduction.toFixed(2)} DH demandes ` +
            `(solde d'avances insuffisant, probablement une paie concurrente).`
          );
        }
      }
    } catch (err) {
      if (createdPaymentId) {
        try { await cancelPayrollPayment(createdPaymentId, createdBy, 'Échec du paiement de paie (annulation automatique)'); }
        catch (cleanupErr) {
          // eslint-disable-next-line no-console
          console.error('[biweeklyPayroll.markPaid] cleanup paiement echoue', createdPaymentId, cleanupErr);
        }
      }
      await db.query(
        `UPDATE biweekly_payroll SET paid = false, paid_at = NULL, payment_method = NULL, advance_deduction = 0 WHERE id = $1`,
        [id]
      );
      throw new Error(`Paiement annulé — la sortie de caisse n'a pas pu être créée : ${err instanceof Error ? err.message : 'erreur inconnue'}`);
    }

    return bp;
  },

  /**
   * Annule le marquage paye (correction d'erreur) — meme nettoyage complet
   * que l'hebdo : sorties de caisse SAL-Q supprimees (ecritures reversees),
   * retenues d'avance re-creditees, flags reset.
   */
  async unmarkPaid(id: string, userId?: string) {
    // Acompte d'un salarie declare deja deduit d'un bulletin mensuel paye :
    // l'annuler fausserait ce bulletin (mig 327).
    const cur = (await db.query('SELECT employee_id, period_start FROM biweekly_payroll WHERE id = $1', [id])).rows[0];
    if (cur) {
      const pm = periodMonth(toDateStr(cur.period_start), 'biweekly');
      const slip = await db.query(
        'SELECT 1 FROM payroll WHERE employee_id = $1 AND month = $2 AND year = $3 AND paid = true AND acomptes_amount > 0',
        [cur.employee_id, pm.month, pm.year]
      );
      if (slip.rowCount) throw new Error(`Cet acompte est déduit du bulletin ${String(pm.month).padStart(2, '0')}/${pm.year} déjà payé : annulez d'abord le paiement de ce bulletin.`);
    }
    const claim = await db.query(
      `UPDATE biweekly_payroll SET paid = false, paid_at = NULL, payment_method = NULL, advance_deduction = 0
         WHERE id = $1 AND paid = true RETURNING *`,
      [id]
    );
    if (claim.rowCount === 0) {
      const existing = await db.query('SELECT * FROM biweekly_payroll WHERE id = $1', [id]);
      return existing.rows[0] || null;
    }
    const bp = claim.rows[0];

    try {
      const periodStartStr = toDateStr(bp.period_start);
      const payments = await db.query(
        `SELECT id FROM payments WHERE type = 'salary' AND employee_id = $1 AND reference LIKE $2`,
        [bp.employee_id, `SAL-Q${periodStartStr}-%`]
      );
      for (const p of payments.rows) {
        await cancelPayrollPayment(p.id, userId, 'Annulation paie');
      }
      await salaryAdvanceRepository.reverseRepayments({ biweeklyPayrollId: id });
    } catch (err) {
      await db.query(
        `UPDATE biweekly_payroll SET paid = true, paid_at = $1, payment_method = $2, advance_deduction = $3
           WHERE id = $4`,
        [bp.paid_at, bp.payment_method, bp.advance_deduction, id]
      );
      throw new Error(`Annulation impossible : ${err instanceof Error ? err.message : 'erreur inconnue'}`);
    }

    const r = await db.query('SELECT * FROM biweekly_payroll WHERE id = $1', [id]);
    return r.rows[0] || null;
  },

  /**
   * Edition d'une ligne : bulletin paye -> notes uniquement (le net a servi
   * a une sortie de caisse) ; non paye -> tout modifiable.
   */
  async update(id: string, data: Record<string, unknown>) {
    const current = await db.query('SELECT paid FROM biweekly_payroll WHERE id = $1', [id]);
    if (!current.rows[0]) return null;
    const isPaid = current.rows[0].paid === true;

    const fullMapping: Record<string, string> = {
      baseAmount: 'base_amount', workedDays: 'worked_days', absentDays: 'absent_days',
      overtimeHours: 'overtime_hours', overtimeAmount: 'overtime_amount',
      netAmount: 'net_amount', notes: 'notes',
    };
    const mapping = isPaid ? { notes: 'notes' } : fullMapping;

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, col] of Object.entries(mapping)) {
      if (data[key] !== undefined) { fields.push(`${col} = $${i++}`); values.push(data[key]); }
    }
    if (fields.length === 0) return null;
    values.push(id);
    const r = await db.query(`UPDATE biweekly_payroll SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return r.rows[0];
  },

  /** Supprime une ligne NON payee. Une ligne payee porte une sortie de caisse
   *  et d'eventuelles retenues d'avance : il faut d'abord annuler le paiement
   *  (unmarkPaid), sinon la caisse et la compta resteraient orphelines. */
  async delete(id: string) {
    const r = await db.query('DELETE FROM biweekly_payroll WHERE id = $1 AND paid IS NOT TRUE RETURNING id', [id]);
    if (r.rowCount === 0) {
      const exists = await db.query('SELECT 1 FROM biweekly_payroll WHERE id = $1', [id]);
      if (exists.rowCount) throw new Error('Ligne deja payee : annulez d\'abord le paiement avant de la supprimer');
    }
  },
};
