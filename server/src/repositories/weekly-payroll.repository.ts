import { db } from '../config/database.js';
import { paymentRepository } from './accounting.repository.js';
import { salaryAdvanceRepository } from './salary-advance.repository.js';
import { getLocalISODate } from '../utils/timezone.js';

/**
 * Paie hebdomadaire.
 *
 * Modele simple : 1 ligne par employe x semaine (lundi -> dimanche).
 * Le manager declenche la generation pour une semaine de reference, le
 * systeme calcule le net a payer depuis le pointage de la semaine, puis
 * il coche les employes au fur et a mesure des paiements.
 *
 * Convention salaire (regle metier officielle — B, validee 07/2026,
 * commit 65d0c16) :
 *   dailyRate = weekly_salary / 7
 *   Le repos hebdomadaire est PAYE PROPORTIONNELLEMENT aux jours travailles :
 *     reposDays = 0                        si workedDays < 4  (seuil metier)
 *     reposDays = min(workedDays / 6, 1)   sinon
 *   Ainsi 6 jours travailles = 1 j de repos paye -> 7/7 = salaire complet ;
 *   4 jours travailles = 0,67 j paye -> 4,67 payes ;
 *   moins de 4 jours = pas de repos paye.
 *   Les jours pointes 'repos' ne sont PAS comptes comme travailles (le +/-
 *   automatique les couvre — sinon double comptage).
 *   baseAmount = dailyRate × paidDays  (paidDays = workedDays + reposDays)
 *   overtimeHours = SUM(attendance.overtime_minutes) / 60
 *   overtimeAmount = overtimeHours × (dailyRate / 8) × 1.25
 *   netAmount = baseAmount + overtimeAmount
 *
 * Regle centrale : cf. reposDaysFor() ci-dessous. AUCUN recalcul cote
 * frontend — la valeur est renvoyee par le serveur dans les colonnes
 * `paid_days` / `repos_days` de la vue list().
 *
 * Note : pas de CNSS/IR ici (les employes hebdo sont typiquement
 * journaliers/extras, paye au noir ou en CDD courte duree). Si besoin,
 * cumuler dans le futur via une logique similaire au mensuel.
 */

/**
 * Repos paye proportionnel — regle metier officielle (voir docblock ci-dessus).
 * SEUL point de verite : ne PAS reimplementer cote frontend ni ailleurs.
 */
export function reposDaysFor(workedDays: number): number {
  if (workedDays < 4) return 0;
  return Math.min(workedDays / 6, 1);
}
/**
 * pg renvoie les colonnes DATE comme objets Date JS (pas de type parser
 * custom) : formatte en 'YYYY-MM-DD' local sans passer par toISOString
 * (qui peut decaler d'un jour selon le fuseau).
 */
function toDateStr(v: unknown): string {
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 10);
}

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
         wp.advance_deduction,
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
    // Enrichit avec le repos paye et les jours payes calcules SERVEUR.
    // Le frontend affiche ces valeurs telles quelles — plus aucun recalcul
    // client (elimine les divergences repos paye / net).
    return result.rows.map((row: Record<string, unknown>) => {
      const wd = parseFloat(String(row.worked_days ?? 0));
      const repos = Number.isFinite(wd) ? reposDaysFor(wd) : 0;
      return {
        ...row,
        repos_days: Math.round(repos * 100) / 100,
        paid_days: Math.round((wd + repos) * 100) / 100,
      };
    });
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
      const dailyRate = weeklySalary / 7;

      const att = await db.query(
        // 'repos' est EXCLU des jours travailles : le repos paye est ajoute
        // automatiquement (+1) ci-dessous, le pointer ne doit pas doubler.
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
        [emp.id, weekStart, weekEnd]
      );
      const a = att.rows[0];
      // Demi-journee = 0.5 jour paye (un simple half_day compte donc 0.5).
      const workedDays = a.present_days + 2 * a.double_days + 0.5 * a.half_days;
      const absentDays = a.absent_days;
      const overtimeHours = a.total_overtime_min / 60;
      // Repos hebdomadaire paye — regle metier centralisee (voir docblock).
      const reposDays = reposDaysFor(workedDays);
      const paidDays = workedDays + reposDays;
      const baseAmount = r2(dailyRate * paidDays);
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
  async markPaid(id: string, paymentMethod: string, createdBy?: string, storeId?: string, advanceDeduction = 0) {
    // Pre-validation net + solde d'avances (voir employee.repository.ts:markPaid
    // pour le raisonnement complet). L'atomicite reelle est portee par le
    // UPDATE conditionnel qui suit.
    const existing = await db.query('SELECT * FROM weekly_payroll WHERE id = $1', [id]);
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

    // Verrou d'idempotence atomique : double-clic -> seule la 1re requete
    // matche paid=false, la 2e reprend l'etat courant sans re-payer.
    // paid_by (mig 239) : trace QUI a valide le paiement (conformite audit).
    const claim = await db.query(
      `UPDATE weekly_payroll SET paid = true, paid_at = NOW(), payment_method = $1,
                                 advance_deduction = $2, paid_by = $3, updated_by = $3
         WHERE id = $4 AND paid = false RETURNING *`,
      [paymentMethod, deduction, createdBy || null, id]
    );
    if (claim.rowCount === 0) {
      const now = await db.query('SELECT * FROM weekly_payroll WHERE id = $1', [id]);
      return now.rows[0] || null;
    }
    const wp = claim.rows[0];

    // Recupere infos employe pour la description comptable
    const emp = await db.query('SELECT first_name, last_name FROM employees WHERE id = $1', [wp.employee_id]);
    const empName = emp.rows[0] ? `${emp.rows[0].first_name} ${emp.rows[0].last_name}` : '';

    const catResult = await db.query(`SELECT id FROM expense_categories WHERE name = 'Salaires' AND type = 'expense' LIMIT 1`);
    const categoryId = catResult.rows[0]?.id || null;

    // Decaissement reel = net moins la retenue (le cash de l'avance est deja
    // sorti a l'octroi — une seule sortie caisse au total).
    // Rollback complet en cas d'echec : supprime le paiement deja cree + reset
    // du flag paid. Verifie aussi le retour d'applyDeduction pour detecter une
    // retenue partielle (course avec une paie concurrente).
    let createdPaymentId: string | null = null;
    try {
      const weekStartStr = toDateStr(wp.week_start);
      const cashOut = Math.round((net - deduction) * 100) / 100;
      if (cashOut > 0) {
        const payment = await paymentRepository.create({
          // reference VARCHAR(50) : tronque pour ne pas echouer sur un nom long
          reference: `SAL-S${weekStartStr}-${empName.replace(/\s+/g, '')}`.slice(0, 50),
          type: 'salary',
          categoryId,
          employeeId: wp.employee_id,
          amount: cashOut,
          paymentMethod,
          paymentDate: getLocalISODate(),
          description: `Salaire semaine du ${weekStartStr} - ${empName}`
            + (deduction > 0 ? ` (retenue avance ${deduction.toFixed(2)} DH)` : ''),
          createdBy: createdBy || wp.employee_id,
          storeId,
        });
        createdPaymentId = payment?.id ?? null;
      }

      if (deduction > 0) {
        const applied = await salaryAdvanceRepository.applyDeduction({
          employeeId: wp.employee_id as string,
          amount: deduction,
          weeklyPayrollId: id,
          userId: createdBy || (wp.employee_id as string),
          storeId,
          label: `${empName} semaine du ${weekStartStr}`,
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
        try { await paymentRepository.delete(createdPaymentId); }
        catch (cleanupErr) {
          // eslint-disable-next-line no-console
          console.error('[weeklyPayroll.markPaid] cleanup paiement echoue', createdPaymentId, cleanupErr);
        }
      }
      await db.query(
        `UPDATE weekly_payroll SET paid = false, paid_at = NULL, payment_method = NULL, advance_deduction = 0 WHERE id = $1`,
        [id]
      );
      throw new Error(`Paiement annulé — la sortie de caisse n'a pas pu être créée : ${err instanceof Error ? err.message : 'erreur inconnue'}`);
    }

    return wp;
  },

  /**
   * Annule le marquage paye (correction d'erreur). Nettoie TOUT ce que le
   * paiement avait cree, pour permettre de re-payer sans doublon :
   *  - supprime les sorties de caisse liees (reference SAL-S{semaine}-...)
   *    -> leurs ecritures comptables sont reversees ;
   *  - reverse les retenues d'avance imputees (solde re-credite) ;
   *  - reset les flags paid/paid_at/payment_method/advance_deduction.
   */
  async unmarkPaid(id: string) {
    // Idempotence : UPDATE conditionnel + restauration si le cleanup echoue.
    const claim = await db.query(
      `UPDATE weekly_payroll SET paid = false, paid_at = NULL, payment_method = NULL, advance_deduction = 0
         WHERE id = $1 AND paid = true RETURNING *`,
      [id]
    );
    if (claim.rowCount === 0) {
      const existing = await db.query('SELECT * FROM weekly_payroll WHERE id = $1', [id]);
      return existing.rows[0] || null;
    }
    const wp = claim.rows[0];

    try {
      const weekStartStr = toDateStr(wp.week_start);
      const payments = await db.query(
        `SELECT id FROM payments WHERE type = 'salary' AND employee_id = $1 AND reference LIKE $2`,
        [wp.employee_id, `SAL-S${weekStartStr}-%`]
      );
      for (const p of payments.rows) {
        await paymentRepository.delete(p.id);
      }
      await salaryAdvanceRepository.reverseRepayments({ weeklyPayrollId: id });
    } catch (err) {
      await db.query(
        `UPDATE weekly_payroll SET paid = true, paid_at = $1, payment_method = $2, advance_deduction = $3
           WHERE id = $4`,
        [wp.paid_at, wp.payment_method, wp.advance_deduction, id]
      );
      throw new Error(`Annulation impossible : ${err instanceof Error ? err.message : 'erreur inconnue'}`);
    }

    const r = await db.query('SELECT * FROM weekly_payroll WHERE id = $1', [id]);
    return r.rows[0] || null;
  },

  /**
   * Edition d'une ligne paie hebdo.
   * - Bulletin paye : SEULES les notes sont modifiables (le net a servi a une
   *   sortie de caisse — reecrire base_amount ou net_amount desynchroniserait
   *   la compta).
   * - Bulletin non paye : tout est modifiable (correction manuelle avant paie).
   */
  async update(id: string, data: Record<string, unknown>) {
    const current = await db.query('SELECT paid FROM weekly_payroll WHERE id = $1', [id]);
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
    const r = await db.query(`UPDATE weekly_payroll SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, values);
    return r.rows[0];
  },

  async delete(id: string) {
    await db.query('DELETE FROM weekly_payroll WHERE id = $1', [id]);
  },
};
