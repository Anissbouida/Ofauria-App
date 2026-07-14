import type { PoolClient } from 'pg';
import { db } from '../config/database.js';
import { FLAGS } from '../config/feature-flags.js';
import { paymentRepository } from './accounting.repository.js';
import { persistEntry, reverseEntriesForSource } from '../services/journal-generator.service.js';
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
   * paiement on supprime l'avance orpheline (best-effort — si ce nettoyage
   * echoue lui-meme, on laisse une avance sans payment_id detectable par un
   * script de reconciliation).
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
      try { await db.query('DELETE FROM salary_advances WHERE id = $1', [advance.id]); }
      catch (cleanupErr) {
        // eslint-disable-next-line no-console
        console.error('[salaryAdvance.create] cleanup avance orpheline echoue', advance.id, cleanupErr);
      }
      throw err;
    }

    const updated = await db.query(
      'UPDATE salary_advances SET payment_id = $1 WHERE id = $2 RETURNING *',
      [payment.id, advance.id]
    );
    return updated.rows[0];
  },

  /**
   * Reverse les retenues imputees par une paie (annulation de paiement) :
   * re-credite le solde des avances, reverse les ecritures 6171/3431 et
   * supprime les lignes de remboursement. Retourne le total re-credite.
   */
  async reverseRepayments(params: { payrollId?: string; weeklyPayrollId?: string }): Promise<number> {
    const col = params.payrollId ? 'payroll_id' : 'weekly_payroll_id';
    const val = params.payrollId || params.weeklyPayrollId;
    if (!val) return 0;
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const reps = await client.query(
        `SELECT sr.id, sr.advance_id, sr.amount
           FROM salary_advance_repayments sr
          WHERE sr.${col} = $1
          FOR UPDATE`,
        [val]
      );
      let reversed = 0;
      for (const rep of reps.rows) {
        if (FLAGS.LEDGER_AUTOGEN) {
          await reverseEntriesForSource(client as PoolClient, {
            sourceId: rep.id, sourceKinds: ['advance_repayment'],
          });
        }
        await client.query(
          `UPDATE salary_advances
              SET remaining_amount = remaining_amount + $1,
                  status = CASE WHEN remaining_amount + $1 >= amount THEN 'open' ELSE 'partial' END
            WHERE id = $2`,
          [rep.amount, rep.advance_id]
        );
        await client.query('DELETE FROM salary_advance_repayments WHERE id = $1', [rep.id]);
        reversed = Math.round((reversed + parseFloat(rep.amount)) * 100) / 100;
      }
      await client.query('COMMIT');
      return reversed;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Modifie une avance existante (admin).
   *  - monthlyDeduction (plan d'etalement) et notes : modifiables a tout
   *    moment — les retenues futures suivront le nouveau plan.
   *  - amount / paymentMethod / advanceDate : uniquement si AUCUNE retenue
   *    n'a encore ete imputee. Le decaissement lie (payments) est mis a
   *    jour et son ecriture comptable regeneree.
   */
  async update(id: string, data: {
    amount?: number; paymentMethod?: string; advanceDate?: string;
    /** undefined = inchange ; null = supprimer le plan ; nombre = nouveau plan */
    monthlyDeduction?: number | null; notes?: string;
  }) {
    const existing = await db.query(
      `SELECT a.*, COUNT(sr.id)::int AS repayment_count
         FROM salary_advances a
         LEFT JOIN salary_advance_repayments sr ON sr.advance_id = a.id
        WHERE a.id = $1
        GROUP BY a.id`,
      [id]
    );
    const adv = existing.rows[0];
    if (!adv) throw new Error('Avance introuvable');

    const touchesDisbursement = data.amount !== undefined
      || data.paymentMethod !== undefined || data.advanceDate !== undefined;
    if (touchesDisbursement && adv.repayment_count > 0) {
      throw new Error('Des retenues ont déjà été faites : seuls le plan de retenue et les notes sont modifiables');
    }

    const newAmount = data.amount !== undefined ? Math.round(data.amount * 100) / 100 : parseFloat(adv.amount);
    if (newAmount <= 0) throw new Error('Montant invalide');
    const newMonthly = data.monthlyDeduction === undefined
      ? (adv.monthly_deduction !== null ? parseFloat(adv.monthly_deduction) : null)
      : data.monthlyDeduction;
    if (newMonthly !== null && (newMonthly <= 0 || newMonthly > newAmount)) {
      throw new Error('La retenue mensuelle doit être comprise entre 0 et le montant de l\'avance');
    }

    const sets: string[] = []; const values: unknown[] = []; let i = 1;
    if (data.amount !== undefined) {
      // Aucune retenue (verifie ci-dessus) -> le solde restant = le montant
      sets.push(`amount = $${i}, remaining_amount = $${i}`); values.push(newAmount); i++;
    }
    if (data.advanceDate !== undefined) { sets.push(`advance_date = $${i++}`); values.push(data.advanceDate); }
    if (data.paymentMethod !== undefined) { sets.push(`payment_method = $${i++}`); values.push(data.paymentMethod); }
    if (data.monthlyDeduction !== undefined) { sets.push(`monthly_deduction = $${i++}`); values.push(data.monthlyDeduction); }
    if (data.notes !== undefined) { sets.push(`notes = $${i++}`); values.push(data.notes || null); }
    if (sets.length === 0) return adv;

    values.push(id);
    const updated = await db.query(
      `UPDATE salary_advances SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );

    // Repercute sur le decaissement lie (regenere l'ecriture 3431/tresorerie)
    if (touchesDisbursement && adv.payment_id) {
      await paymentRepository.update(adv.payment_id, {
        ...(data.amount !== undefined ? { amount: newAmount } : {}),
        ...(data.paymentMethod !== undefined ? { paymentMethod: data.paymentMethod } : {}),
        ...(data.advanceDate !== undefined ? { paymentDate: data.advanceDate } : {}),
      });
    }
    return updated.rows[0];
  },

  /**
   * Supprime une avance saisie par erreur. Refuse si des retenues existent
   * (il faudrait d'abord annuler les paies concernees). Supprime aussi le
   * decaissement lie, ce qui reverse son ecriture comptable.
   *
   * Le verrou FOR UPDATE sur salary_advances garantit qu'une retenue
   * concurrente (applyDeduction prend aussi FOR UPDATE sur ces lignes) ne
   * peut pas s'inserer entre le check repayment_count et le DELETE.
   *
   * Ordre : paiement -> avance. La FK salary_advances.payment_id est
   * ON DELETE SET NULL : supprimer le paiement d'abord ne casse rien, et
   * si le DELETE de l'avance echoue derriere on garde une avance orpheline
   * (payment_id NULL) detectable — moins pire qu'un paiement sans avance.
   */
  async remove(id: string) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        `SELECT a.id, a.payment_id, COUNT(sr.id)::int AS repayment_count
           FROM salary_advances a
           LEFT JOIN salary_advance_repayments sr ON sr.advance_id = a.id
          WHERE a.id = $1
          GROUP BY a.id, a.payment_id
          FOR UPDATE OF a`,
        [id]
      );
      const row = existing.rows[0];
      if (!row) throw new Error('Avance introuvable');
      if (row.repayment_count > 0) {
        throw new Error('Avance deja partiellement remboursee : suppression impossible');
      }
      const paymentId = row.payment_id;
      if (paymentId) {
        // paymentRepository.delete a sa propre transaction (reverse ledger +
        // resync facture). Si elle echoue, on ROLLBACK notre transaction sans
        // avoir touche a l'avance -> etat coherent.
        await paymentRepository.delete(paymentId);
      }
      await client.query('DELETE FROM salary_advances WHERE id = $1', [id]);
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
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
