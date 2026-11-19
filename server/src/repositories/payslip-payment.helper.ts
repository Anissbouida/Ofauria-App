import { db } from '../config/database.js';
import { paymentRepository } from './accounting.repository.js';
import { salaryAdvanceRepository } from './salary-advance.repository.js';
import { getLocalISODate } from '../utils/timezone.js';
import { currencySymbol } from '../services/currency.js';

/**
 * G0-14 — paiement d'un bulletin, corps commun aux paies mensuelle, hebdomadaire et de quinzaine.
 * À appeler DANS une transaction (withTransaction) : un échec annule ensemble la sortie de caisse,
 * la retenue d'avance et le marquage payé.
 *
 * Étapes : verrou de la ligne → net à payer (règle propre au type, ex. acomptes du mensuel) →
 * contrôle de la retenue d'avance → marquage payé idempotent (UPDATE … WHERE paid = false) →
 * sortie de caisse du net moins la retenue (le cash de l'avance est sorti à l'octroi) → imputation
 * de la retenue, refusée si elle n'est que partielle (paie concurrente).
 * `paidNow` : vrai seulement si CET appel a payé (faux si déjà payé ou payé en concurrence).
 */
export type PayslipTable = 'payroll' | 'weekly_payroll' | 'biweekly_payroll';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export interface PayslipKind {
  table: PayslipTable;
  /** Clé de rattachement de la retenue d'avance (salaryAdvanceRepository.applyDeduction). */
  deductionLink: 'payrollId' | 'weeklyPayrollId' | 'biweeklyPayrollId';
  /** Net à payer avant retenue ; `note` complète le libellé du paiement. Peut lever une erreur métier. */
  netOf: (row: Row) => Promise<{ net: number; note?: string }>;
  /** Référence (≤ 50 car.), libellé du paiement et libellé de la retenue. */
  describe: (row: Row, empName: string) => { reference: string; description: string; label: string };
}

export async function payPayslip(kind: PayslipKind, id: string,
  opts: { paymentMethod: string; createdBy?: string; storeId?: string; advanceDeduction?: number }): Promise<{ row: any; paidNow: boolean }> {
  // Verrou de la ligne : un double clic attend, puis voit le bulletin déjà payé.
  const current = (await db.query(`SELECT * FROM ${kind.table} WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  if (!current) return { row: null, paidNow: false };
  if (current.paid) return { row: current, paidNow: false };

  const { net, note } = await kind.netOf(current);
  const deduction = Math.max(0, Math.round((opts.advanceDeduction || 0) * 100) / 100);
  if (deduction > 0) {
    const outstandingRes = await salaryAdvanceRepository.outstandingByEmployee(current.employee_id as string);
    const outstanding = parseFloat(outstandingRes[0]?.outstanding || '0');
    if (deduction > Math.min(net, outstanding) + 0.005) {
      throw new Error(`Retenue ${deduction.toFixed(2)} ${currencySymbol()} superieure au net a payer (${net.toFixed(2)} ${currencySymbol()}) ou au solde d'avances (${outstanding.toFixed(2)} ${currencySymbol()})`);
    }
  }

  // Verrou d'idempotence atomique : seule la première requête trouve paid = false.
  // paid_by (mig 239) : trace QUI a validé le paiement.
  const claim = await db.query(
    `UPDATE ${kind.table} SET paid = true, paid_at = NOW(), payment_method = $1,
                         advance_deduction = $2, paid_by = $3, updated_by = $3
      WHERE id = $4 AND paid = false RETURNING *`,
    [opts.paymentMethod, deduction, opts.createdBy || null, id]);
  if (claim.rowCount === 0) return { row: (await db.query(`SELECT * FROM ${kind.table} WHERE id = $1`, [id])).rows[0] || null, paidNow: false };
  const row = claim.rows[0];

  const emp = (await db.query('SELECT first_name, last_name FROM employees WHERE id = $1', [row.employee_id])).rows[0];
  const empName = emp ? `${emp.first_name} ${emp.last_name}` : '';
  const categoryId = (await db.query(`SELECT id FROM expense_categories WHERE name = 'Salaires' AND type = 'expense' LIMIT 1`)).rows[0]?.id || null;
  const d = kind.describe(row, empName);

  try {
    const cashOut = Math.round((net - deduction) * 100) / 100;
    if (cashOut > 0) {
      await paymentRepository.create({
        reference: d.reference.slice(0, 50),
        type: 'salary',
        categoryId,
        employeeId: row.employee_id,
        amount: cashOut,
        paymentMethod: opts.paymentMethod,
        paymentDate: getLocalISODate(),
        description: d.description + (note ?? '') + (deduction > 0 ? ` (retenue avance ${deduction.toFixed(2)} ${currencySymbol()})` : ''),
        createdBy: opts.createdBy || row.employee_id,
        storeId: opts.storeId,
      });
    }
    if (deduction > 0) {
      const applied = await salaryAdvanceRepository.applyDeduction({
        employeeId: row.employee_id as string,
        amount: deduction,
        [kind.deductionLink]: id,
        userId: opts.createdBy || (row.employee_id as string),
        storeId: opts.storeId,
        label: d.label,
      });
      // Course avec une autre paie : la créance 3431 ne serait éteinte qu'en partie. Refusé.
      if (Math.abs(applied - deduction) > 0.005) {
        throw new Error(
          `Retenue partielle : ${applied.toFixed(2)} ${currencySymbol()} imputes sur ${deduction.toFixed(2)} ${currencySymbol()} demandes ` +
          `(solde d'avances insuffisant, probablement une paie concurrente).`);
      }
    }
  } catch (err) {
    // La transaction annule la sortie de caisse, la retenue et le marquage payé.
    throw new Error(`Paiement annulé — la sortie de caisse n'a pas pu être créée : ${err instanceof Error ? err.message : 'erreur inconnue'}`);
  }
  return { row, paidNow: true };
}
