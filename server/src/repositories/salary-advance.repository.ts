import type { PoolClient } from 'pg';
import { db } from '../config/database.js';
import { FLAGS } from '../config/feature-flags.js';
import { paymentRepository } from './accounting.repository.js';
import { persistEntry } from '../services/journal-generator.service.js';
import { getLocalISODate } from '../utils/timezone.js';

/**
 * Avances sur salaire.
 *
 * Une avance est une CREANCE sur l'employe (compte 3431), pas une charge :
 *  - a l'octroi : ligne payments type='advance' (le cash sort du tiroir,
 *    visible dans Caisse) + ecriture 3431 D / tresorerie C ;
 *  - a chaque paie : retenue sur le net (salary_advance_repayments) +
 *    ecriture 6171 D / 3431 C (la charge salaire est reconnue, la creance
 *    diminue, AUCUN mouvement de tresorerie — le cash n'est sorti qu'une fois).
 *
 * Le solde (remaining_amount) est decremente FIFO : les retenues soldent
 * d'abord la plus ancienne avance ouverte.
 */
export const salaryAdvanceRepository = {
  async list(params: { employeeId?: string; status?: string; storeId?: string }) {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (params.employeeId) { conditions.push(`a.employee_id = $${i++}`); values.push(params.employeeId); }
    if (params.status === 'open') { conditions.push(`a.status != 'repaid'`); }
    else if (params.status) { conditions.push(`a.status = $${i++}`); values.push(params.status); }
    if (params.storeId) { conditions.push(`(a.store_id = $${i++} OR a.store_id IS NULL)`); values.push(params.storeId); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await db.query(
      `SELECT a.*, e.first_name, e.last_name, e.role AS employee_role, e.pay_frequency,
              COALESCE(r.repayments, '[]'::json) AS repayments
         FROM salary_advances a
         JOIN employees e ON e.id = a.employee_id
         LEFT JOIN LATERAL (
           SELECT json_agg(json_build_object(
                    'id', sr.id,
                    'amount', sr.amount,
                    'repaymentDate', to_char(sr.repayment_date, 'YYYY-MM-DD'),
                    'payrollMonth', p.month, 'payrollYear', p.year,
                    'weekStart', to_char(wp.week_start, 'YYYY-MM-DD')
                  ) ORDER BY sr.repayment_date, sr.created_at) AS repayments
             FROM salary_advance_repayments sr
             LEFT JOIN payroll p ON p.id = sr.payroll_id
             LEFT JOIN weekly_payroll wp ON wp.id = sr.weekly_payroll_id
            WHERE sr.advance_id = a.id
         ) r ON true
         ${where}
         ORDER BY a.advance_date DESC, a.created_at DESC`,
      values
    );
    return result.rows;
  },

  /**
   * Solde d'avances en cours par employe (pour le dialogue de paie et les
   * tuiles). `suggested` = retenue proposee pour la prochaine paie en
   * respectant le plan d'etalement : par avance, monthly_deduction si
   * definie (plafonnee au solde restant), sinon tout le solde.
   */
  async outstandingByEmployee(employeeId?: string) {
    const where = employeeId ? 'AND employee_id = $1' : '';
    const result = await db.query(
      `SELECT employee_id,
              COALESCE(SUM(remaining_amount), 0) AS outstanding,
              COALESCE(SUM(LEAST(remaining_amount, COALESCE(monthly_deduction, remaining_amount))), 0) AS suggested
         FROM salary_advances
        WHERE status != 'repaid' ${where}
        GROUP BY employee_id`,
      employeeId ? [employeeId] : []
    );
    return result.rows;
  },

  /**
   * Accorde une avance : ligne salary_advances + decaissement payments
   * type='advance' (avec ecriture 3431 D / tresorerie C si LEDGER_AUTOGEN).
   * paymentRepository.create gere sa propre transaction ; en cas d'echec du
   * paiement on supprime l'avance orpheline avant de relancer l'erreur.
   */
  async create(data: {
    employeeId: string; amount: number; paymentMethod: string;
    advanceDate?: string; notes?: string; createdBy: string; storeId?: string;
    /** Plan d'etalement : retenue proposee par paie. NULL = tout a la prochaine paie. */
    monthlyDeduction?: number | null;
  }) {
    const emp = await db.query('SELECT first_name, last_name FROM employees WHERE id = $1', [data.employeeId]);
    if (!emp.rows[0]) throw new Error('Employe introuvable');
    const empName = `${emp.rows[0].first_name} ${emp.rows[0].last_name}`;
    const advanceDate = data.advanceDate || getLocalISODate();

    const inserted = await db.query(
      `INSERT INTO salary_advances (employee_id, amount, advance_date, payment_method, remaining_amount, notes, created_by, store_id, monthly_deduction)
       VALUES ($1, $2, $3, $4, $2, $5, $6, $7, $8) RETURNING *`,
      [data.employeeId, data.amount, advanceDate, data.paymentMethod,
       data.notes || null, data.createdBy, data.storeId || null,
       data.monthlyDeduction ?? null]
    );
    const advance = inserted.rows[0];

    const catResult = await db.query(
      `SELECT id FROM expense_categories WHERE name = 'Avances sur salaire' LIMIT 1`
    );

    let payment;
    try {
      payment = await paymentRepository.create({
        reference: `AVA-${advanceDate}-${empName.replace(/\s+/g, '')}`,
        type: 'advance',
        categoryId: catResult.rows[0]?.id,
        employeeId: data.employeeId,
        amount: data.amount,
        paymentMethod: data.paymentMethod,
        paymentDate: advanceDate,
        description: `Avance sur salaire - ${empName}`,
        createdBy: data.createdBy,
        storeId: data.storeId,
      });
    } catch (err) {
      await db.query('DELETE FROM salary_advances WHERE id = $1', [advance.id]);
      throw err;
    }

    const updated = await db.query(
      'UPDATE salary_advances SET payment_id = $1 WHERE id = $2 RETURNING *',
      [payment.id, advance.id]
    );
    return updated.rows[0];
  },

  /**
   * Supprime une avance saisie par erreur. Refuse si des retenues existent
   * (il faudrait d'abord annuler les paies concernees). Supprime aussi le
   * decaissement lie, ce qui reverse son ecriture comptable.
   */
  async remove(id: string) {
    const existing = await db.query(
      `SELECT a.payment_id, COUNT(sr.id)::int AS repayment_count
         FROM salary_advances a
         LEFT JOIN salary_advance_repayments sr ON sr.advance_id = a.id
        WHERE a.id = $1
        GROUP BY a.id, a.payment_id`,
      [id]
    );
    const row = existing.rows[0];
    if (!row) throw new Error('Avance introuvable');
    if (row.repayment_count > 0) {
      throw new Error('Avance deja partiellement remboursee : suppression impossible');
    }
    // L'avance d'abord (sa FK payment_id serait mise a NULL par la suppression
    // du paiement, mais l'ordre inverse laisserait une avance sans decaissement
    // si la suppression du paiement echoue sur une periode cloturee).
    const paymentId = row.payment_id;
    if (paymentId) {
      await paymentRepository.delete(paymentId);
    }
    await db.query('DELETE FROM salary_advances WHERE id = $1', [id]);
  },

  /**
   * Applique une retenue de `amount` sur les avances ouvertes de l'employe,
   * FIFO (plus ancienne d'abord). Cree les lignes de remboursement liees a
   * la paie source + l'ecriture 6171 D / 3431 C par avance touchee.
   *
   * Retourne le montant effectivement impute (peut etre < amount si le solde
   * d'avances est insuffisant — l'appelant valide avant, ceinture+bretelles).
   */
  async applyDeduction(data: {
    employeeId: string; amount: number;
    payrollId?: string; weeklyPayrollId?: string;
    userId: string; storeId?: string; label: string;
  }): Promise<number> {
    if (data.amount <= 0) return 0;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const open = await client.query(
        `SELECT id, remaining_amount FROM salary_advances
          WHERE employee_id = $1 AND status != 'repaid' AND remaining_amount > 0
          ORDER BY advance_date, created_at
          FOR UPDATE`,
        [data.employeeId]
      );

      const today = getLocalISODate();
      let toAllocate = Math.round(data.amount * 100) / 100;
      let applied = 0;

      for (const adv of open.rows) {
        if (toAllocate <= 0) break;
        const remaining = parseFloat(adv.remaining_amount);
        const take = Math.round(Math.min(remaining, toAllocate) * 100) / 100;

        const rep = await client.query(
          `INSERT INTO salary_advance_repayments (advance_id, payroll_id, weekly_payroll_id, amount, repayment_date)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [adv.id, data.payrollId || null, data.weeklyPayrollId || null, take, today]
        );

        await client.query(
          `UPDATE salary_advances
              SET remaining_amount = remaining_amount - $1,
                  status = CASE WHEN remaining_amount - $1 <= 0 THEN 'repaid' ELSE 'partial' END
            WHERE id = $2`,
          [take, adv.id]
        );

        if (FLAGS.LEDGER_AUTOGEN) {
          // Retenue = reconnaissance de la charge salaire pour la part deja
          // decaissee a l'octroi + extinction de la creance. Pas de tresorerie.
          await persistEntry(client as PoolClient, {
            journal_code: 'OD',
            entry_date: today,
            description: `Retenue avance sur salaire - ${data.label}`,
            source_kind: 'advance_repayment',
            source_id: rep.rows[0].id,
            store_id: data.storeId || null,
            lines: [
              { account_code: '6171', debit: take, credit: 0, label: `Salaire (part retenue avance) - ${data.label}` },
              { account_code: '3431', debit: 0, credit: take, label: `Remboursement avance - ${data.label}` },
            ],
          }, { userId: data.userId });
        }

        toAllocate = Math.round((toAllocate - take) * 100) / 100;
        applied = Math.round((applied + take) * 100) / 100;
      }

      await client.query('COMMIT');
      return applied;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};
