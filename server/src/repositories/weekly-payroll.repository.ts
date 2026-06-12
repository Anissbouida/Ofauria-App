import { db } from '../config/database.js';
import { paymentRepository } from './accounting.repository.js';
import { getLocalISODate } from '../utils/timezone.js';

/**
 * Paie hebdomadaire.
 *
 * Modele simple : 1 ligne par employe x semaine (lundi -> dimanche).
 * Le manager declenche la generation pour une semaine de reference, le
 * systeme calcule le net a payer depuis le pointage de la semaine, puis
 * il coche les employes au fur et a mesure des paiements.
 *
 * Convention salaire :
 *   dailyRate = weekly_salary / 6  (6 jours travailles par semaine)
 *   baseAmount = dailyRate × workedDays
 *   overtimeHours = SUM(attendance.overtime_minutes) / 60
 *   overtimeAmount = overtimeHours × (dailyRate / 8) × 1.25
 *   netAmount = baseAmount + overtimeAmount
 *
 * Note : pas de CNSS/IR ici (les employes hebdo sont typiquement
 * journaliers/extras, paye au noir ou en CDD courte duree). Si besoin,
 * cumuler dans le futur via une logique similaire au mensuel.
 */
export const weeklyPayrollRepository = {
  /**
   * Liste enrichie : employes weekly + leur ligne sur la semaine (ou null
   * si pas encore generee). Utilise par l'UI pour afficher la liste
   * complete meme avant generation.
   */
  async list(weekStart: string, _weekEnd: string, storeId?: string) {
    // weekEnd ne sert pas pour le filtre LEFT JOIN (UNIQUE(employee_id, week_start)
    // suffit a recuperer la ligne unique) mais on garde la signature pour symetrie
    // avec generate().
    const result = await db.query(
      `SELECT
         e.id              AS employee_id,
         e.first_name,
         e.last_name,
         e.role,
         e.weekly_salary,
         e.default_shift_code,
         wp.id             AS payroll_id,
         wp.base_amount,
         wp.worked_days,
         wp.absent_days,
         wp.overtime_hours,
         wp.overtime_amount,
         wp.net_amount,
         wp.paid,
         wp.paid_at,
         wp.payment_method,
         wp.notes
       FROM employees e
       LEFT JOIN weekly_payroll wp
         ON wp.employee_id = e.id
        AND wp.week_start = $1::date
       WHERE e.is_active = true
         AND e.pay_frequency = 'weekly'
         ${storeId ? 'AND (e.store_id = $2 OR e.store_id IS NULL)' : ''}
       ORDER BY e.last_name, e.first_name`,
      storeId ? [weekStart, storeId] : [weekStart]
    );
    return result.rows;
  },

  /**
   * Genere (upsert) les lignes pour tous les employes weekly de la
   * semaine. Calcul depuis attendance + employees.weekly_salary.
   * Conserve les flags `paid` deja positionnes (on ne reset jamais un
   * paiement valide).
   */
  async generate(weekStart: string, weekEnd: string, storeId?: string) {
    const storeFilter = storeId ? 'AND (e.store_id = $1 OR e.store_id IS NULL)' : '';
    const employeesRes = await db.query(
      `SELECT e.id, e.weekly_salary
         FROM employees e
        WHERE e.is_active = true
          AND e.pay_frequency = 'weekly'
          AND e.weekly_salary IS NOT NULL
          ${storeFilter}`,
      storeId ? [storeId] : []
    );

    const r2 = (v: number) => Math.round(v * 100) / 100;
    const results: Array<Record<string, unknown>> = [];

    for (const emp of employeesRes.rows) {
      const weeklySalary = parseFloat(emp.weekly_salary as string);
      const dailyRate = weeklySalary / 6;

      const att = await db.query(
        // 'repos' = jour paye au meme titre que 'present'/'late' (jour de
        // repos hebdomadaire inclus dans le salaire).
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('present', 'late', 'repos'))::int AS present_days,
           COUNT(*) FILTER (WHERE status = 'absent')::int                     AS absent_days,
           COUNT(*) FILTER (WHERE status = 'half_day')::int                   AS half_days,
           COALESCE(SUM(overtime_minutes), 0)::int                            AS total_overtime_min
         FROM attendance
         WHERE employee_id = $1
           AND date BETWEEN $2 AND $3
           AND is_expected = false`,
        [emp.id, weekStart, weekEnd]
      );
      const a = att.rows[0];
      const workedDays = a.present_days + Math.floor(a.half_days / 2);
      const absentDays = a.absent_days;
      const overtimeHours = a.total_overtime_min / 60;
      const baseAmount = r2(dailyRate * workedDays);
      const overtimeAmount = r2(overtimeHours * (dailyRate / 8) * 1.25);
      const netAmount = r2(baseAmount + overtimeAmount);

      const r = await db.query(
        `INSERT INTO weekly_payroll
           (employee_id, week_start, week_end, base_amount, worked_days, absent_days,
            overtime_hours, overtime_amount, net_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (employee_id, week_start) DO UPDATE SET
           week_end = EXCLUDED.week_end,
           base_amount = EXCLUDED.base_amount,
           worked_days = EXCLUDED.worked_days,
           absent_days = EXCLUDED.absent_days,
           overtime_hours = EXCLUDED.overtime_hours,
           overtime_amount = EXCLUDED.overtime_amount,
           -- Si paye, on garde le net_amount existant (ne pas modifier le montant deja paye).
           -- Si non paye, on recalcule.
           net_amount = CASE WHEN weekly_payroll.paid THEN weekly_payroll.net_amount ELSE EXCLUDED.net_amount END
         RETURNING *`,
        [emp.id, weekStart, weekEnd, baseAmount, workedDays, absentDays, overtimeHours, overtimeAmount, netAmount]
      );
      results.push(r.rows[0]);
    }
    return results;
  },

  async findById(id: string) {
    const r = await db.query('SELECT * FROM weekly_payroll WHERE id = $1', [id]);
    return r.rows[0] || null;
  },

  /**
   * Marque comme paye + cree l'ecriture comptable (type 'salary').
   * Idempotent : si deja paye, retourne la ligne sans recreer l'ecriture.
   */
  async markPaid(id: string, paymentMethod: string, createdBy?: string, storeId?: string) {
    const existing = await db.query('SELECT * FROM weekly_payroll WHERE id = $1', [id]);
    const row = existing.rows[0];
    if (!row) return null;
    if (row.paid) return row;

    const r = await db.query(
      `UPDATE weekly_payroll SET paid = true, paid_at = NOW(), payment_method = $1
         WHERE id = $2 RETURNING *`,
      [paymentMethod, id]
    );
    const wp = r.rows[0];

    // Recupere infos employe pour la description comptable
    const emp = await db.query('SELECT first_name, last_name FROM employees WHERE id = $1', [wp.employee_id]);
    const empName = emp.rows[0] ? `${emp.rows[0].first_name} ${emp.rows[0].last_name}` : '';

    const catResult = await db.query(`SELECT id FROM expense_categories WHERE name = 'Salaires' AND type = 'expense' LIMIT 1`);
    const categoryId = catResult.rows[0]?.id || null;

    await paymentRepository.create({
      reference: `SAL-S${(wp.week_start as string).slice(0, 10)}-${empName.replace(/\s+/g, '')}`,
      type: 'salary',
      categoryId,
      employeeId: wp.employee_id,
      amount: parseFloat(wp.net_amount as string),
      paymentMethod,
      paymentDate: getLocalISODate(),
      description: `Salaire semaine du ${(wp.week_start as string).slice(0, 10)} - ${empName}`,
      createdBy: createdBy || wp.employee_id,
      storeId,
    });

    return wp;
  },

  /**
   * Annule le marquage paye (en cas d'erreur). N'annule PAS l'ecriture
   * comptable cree (le manager doit la supprimer manuellement dans
   * l'onglet Paiements s'il veut nettoyer).
   */
  async unmarkPaid(id: string) {
    const r = await db.query(
      `UPDATE weekly_payroll SET paid = false, paid_at = NULL, payment_method = NULL
         WHERE id = $1 RETURNING *`,
      [id]
    );
    return r.rows[0] || null;
  },

  async update(id: string, data: Record<string, unknown>) {
    const mapping: Record<string, string> = {
      baseAmount: 'base_amount', workedDays: 'worked_days', absentDays: 'absent_days',
      overtimeHours: 'overtime_hours', overtimeAmount: 'overtime_amount',
      netAmount: 'net_amount', notes: 'notes',
    };
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, col] of Object.entries(mapping)) {
      if (data[key] !== undefined) { fields.push(`${col} = $${i++}`); values.push(data[key]); }
    }
    if (fields.length === 0) return null;
    values.push(id);
    const r = await db.query(`UPDATE weekly_payroll SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return r.rows[0];
  },

  async delete(id: string) {
    await db.query('DELETE FROM weekly_payroll WHERE id = $1', [id]);
  },
};
