import { db } from '../config/database.js';
import { paymentRepository } from './accounting.repository.js';

/**
 * Declarations sociales et fiscales de la paie mensuelle (lot 5, mig 319).
 *
 * Etats calcules depuis les bulletins (snapshot du bareme, mig 318) :
 *  - CNSS (bordereau BDS) : par salarie declare, jours, salaire reel et
 *    plafonne, cotisations par branche ; total = dette 4441 du mois.
 *  - IR (versement mensuel) : brut imposable, frais pro, cotisations, net
 *    imposable, IR ; total = dette 44525.
 *  - CIMR : cotisations salariales + patronales ; total = dette 4443.
 *  - Recapitulatif annuel IR par salarie (contenu de l'etat 9421).
 * Declarer fige le montant (mois cloture) ; regler cree le paiement qui solde
 * la dette (categorie liee au compte 4441 / 44525 / 4443).
 */

export type DeclarationKind = 'cnss' | 'ir' | 'cimr';

const CATEGORY: Record<DeclarationKind, string> = {
  cnss: '40000000-0000-0000-0000-000000000001',
  ir: '40000000-0000-0000-0000-000000000002',
  cimr: '40000000-0000-0000-0000-000000000003',
};
const LABEL: Record<DeclarationKind, string> = { cnss: 'CNSS / AMO', ir: 'IR sur salaires', cimr: 'CIMR' };

const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export const payrollDeclarationRepository = {
  /** Bordereau CNSS du mois (salaries declares). */
  async cnssStatement(month: number, year: number) {
    const r = await db.query(
      `SELECT p.id, e.id AS employee_id, e.first_name, e.last_name, e.cin, e.cnss_number,
              p.worked_days, p.base_cnss, p.gross_salary,
              p.cnss_employee, p.cnss_employer, p.amo_employee, p.amo_employer,
              p.alloc_familiales, p.taxe_fp, s.cnss_plafond
         FROM payroll p
         JOIN employees e ON e.id = p.employee_id
         LEFT JOIN payroll_tax_scales s ON s.id = p.tax_scale_id
        WHERE p.month = $1 AND p.year = $2 AND COALESCE(p.is_declared, true) = true
        ORDER BY e.last_name, e.first_name`,
      [month, year]
    );
    const rows = r.rows.map(x => {
      const real = num(x.base_cnss ?? x.gross_salary);
      const plafond = num(x.cnss_plafond) || 6000;
      const total = num(x.cnss_employee) + num(x.cnss_employer) + num(x.amo_employee) + num(x.amo_employer)
        + num(x.alloc_familiales) + num(x.taxe_fp);
      return {
        payrollId: x.id, employeeId: x.employee_id,
        name: `${x.last_name} ${x.first_name}`, cin: x.cin, cnssNumber: x.cnss_number,
        // La CNSS declare au plus 26 jours par mois.
        days: Math.min(num(x.worked_days), 26),
        salaireReel: r2(real), salairePlafonne: r2(Math.min(real, plafond)),
        prestationsSalarie: num(x.cnss_employee), prestationsPatronal: num(x.cnss_employer),
        amoSalarie: num(x.amo_employee), amoPatronal: num(x.amo_employer),
        allocFamiliales: num(x.alloc_familiales), taxeFp: num(x.taxe_fp),
        total: r2(total),
      };
    });
    const sum = (k: keyof (typeof rows)[number]) => r2(rows.reduce((s, x) => s + (x[k] as number), 0));
    return {
      rows,
      missingCnssNumber: rows.filter(x => !x.cnssNumber).map(x => x.name),
      totals: {
        salaireReel: sum('salaireReel'), salairePlafonne: sum('salairePlafonne'),
        prestationsSalarie: sum('prestationsSalarie'), prestationsPatronal: sum('prestationsPatronal'),
        amoSalarie: sum('amoSalarie'), amoPatronal: sum('amoPatronal'),
        allocFamiliales: sum('allocFamiliales'), taxeFp: sum('taxeFp'), total: sum('total'),
      },
    };
  },

  /** Etat de versement IR du mois. */
  async irStatement(month: number, year: number) {
    const r = await db.query(
      `SELECT p.id, e.first_name, e.last_name, e.cin, p.nb_dependents,
              COALESCE(p.brut_imposable, p.gross_salary) AS brut_imposable, p.frais_pro,
              p.cnss_employee, p.amo_employee, p.cimr_employee, p.net_imposable, p.ir_gross,
              p.family_deduction, p.ir_net
         FROM payroll p JOIN employees e ON e.id = p.employee_id
        WHERE p.month = $1 AND p.year = $2 AND COALESCE(p.is_declared, true) = true
        ORDER BY e.last_name, e.first_name`,
      [month, year]
    );
    const rows = r.rows.map(x => ({
      payrollId: x.id, name: `${x.last_name} ${x.first_name}`, cin: x.cin, dependents: num(x.nb_dependents),
      brutImposable: num(x.brut_imposable), fraisPro: num(x.frais_pro),
      cotisations: r2(num(x.cnss_employee) + num(x.amo_employee) + num(x.cimr_employee)),
      netImposable: num(x.net_imposable), irBrut: num(x.ir_gross), deductionFamille: num(x.family_deduction),
      ir: num(x.ir_net),
    }));
    const sum = (k: keyof (typeof rows)[number]) => r2(rows.reduce((s, x) => s + (x[k] as number), 0));
    return { rows, totals: { brutImposable: sum('brutImposable'), netImposable: sum('netImposable'), ir: sum('ir') } };
  },

  async cimrTotal(month: number, year: number) {
    const r = await db.query(
      `SELECT COALESCE(SUM(cimr_employee + cimr_employer), 0) AS total
         FROM payroll WHERE month = $1 AND year = $2 AND COALESCE(is_declared, true) = true`,
      [month, year]
    );
    return r2(num(r.rows[0].total));
  },

  /** Recapitulatif annuel par salarie (contenu de l'etat 9421, traitements et salaires). */
  async annualIr(year: number) {
    const r = await db.query(
      `SELECT e.id, e.first_name, e.last_name, e.cin, e.cnss_number, e.address, e.city,
              e.hire_date, MAX(p.nb_dependents) AS dependents,
              COUNT(*)::int AS months, SUM(p.worked_days) AS days,
              SUM(p.gross_salary) AS brut,
              SUM(COALESCE(p.brut_imposable, p.gross_salary)) AS brut_imposable,
              SUM(p.gross_salary - COALESCE(p.brut_imposable, p.gross_salary)) AS exonere,
              SUM(p.frais_pro) AS frais_pro,
              SUM(p.cnss_employee + p.amo_employee + p.cimr_employee) AS cotisations,
              SUM(COALESCE(p.net_imposable, 0)) AS net_imposable,
              SUM(p.ir_net) AS ir
         FROM payroll p JOIN employees e ON e.id = p.employee_id
        WHERE p.year = $1 AND COALESCE(p.is_declared, true) = true
        GROUP BY e.id
        ORDER BY e.last_name, e.first_name`,
      [year]
    );
    return r.rows.map(x => ({
      name: `${x.last_name} ${x.first_name}`, cin: x.cin, cnssNumber: x.cnss_number,
      address: [x.address, x.city].filter(Boolean).join(', '),
      dependents: num(x.dependents), months: x.months, days: num(x.days),
      brut: num(x.brut), exonere: r2(num(x.exonere)), brutImposable: num(x.brut_imposable),
      fraisPro: num(x.frais_pro), cotisations: num(x.cotisations), netImposable: num(x.net_imposable), ir: num(x.ir),
    }));
  },

  async list(month: number, year: number) {
    const r = await db.query(
      `SELECT d.*, u.first_name AS declared_by_first_name, u.last_name AS declared_by_last_name
         FROM payroll_declarations d LEFT JOIN users u ON u.id = d.declared_by
        WHERE d.month = $1 AND d.year = $2`,
      [month, year]
    );
    return r.rows;
  },

  /** Montant du par nature (recalcule depuis les bulletins). */
  async amountDue(kind: DeclarationKind, month: number, year: number) {
    if (kind === 'cnss') return (await this.cnssStatement(month, year)).totals.total;
    if (kind === 'ir') return (await this.irStatement(month, year)).totals.ir;
    return this.cimrTotal(month, year);
  },

  /** Declare (fige le montant) : le mois de paie doit etre cloture. */
  async declare(kind: DeclarationKind, month: number, year: number, reference: string | null, userId: string) {
    const period = await db.query(`SELECT status FROM payroll_periods WHERE year = $1 AND month = $2`, [year, month]);
    if (period.rows[0]?.status !== 'closed') throw new Error('Clôturez d\'abord la paie du mois : la déclaration fige les montants.');
    const existing = await db.query(`SELECT status FROM payroll_declarations WHERE kind = $1 AND year = $2 AND month = $3`, [kind, year, month]);
    if (existing.rows[0]?.status === 'paid') throw new Error('Déclaration déjà réglée.');
    const amount = await this.amountDue(kind, month, year);
    const r = await db.query(
      `INSERT INTO payroll_declarations (kind, year, month, amount, reference, declared_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (kind, year, month) DO UPDATE SET amount = EXCLUDED.amount, reference = EXCLUDED.reference,
         declared_at = NOW(), declared_by = EXCLUDED.declared_by
       RETURNING *`,
      [kind, year, month, amount, reference, userId]
    );
    return r.rows[0];
  },

  /**
   * Regle une declaration : paiement de type charge sur la categorie liee au
   * compte de dette (D 4441 / 44525 / 4443, C tresorerie).
   */
  async settle(kind: DeclarationKind, month: number, year: number, input: { paymentMethod: string; paymentDate: string; userId: string; storeId?: string }) {
    const d = (await db.query(
      `SELECT * FROM payroll_declarations WHERE kind = $1 AND year = $2 AND month = $3`, [kind, year, month]
    )).rows[0];
    if (!d) throw new Error('Déclarez d\'abord ce mois avant de le régler.');
    if (d.status === 'paid') throw new Error('Déclaration déjà réglée.');
    const amount = num(d.amount);
    if (amount <= 0) throw new Error('Rien à régler pour ce mois.');
    const cat = await db.query('SELECT id FROM expense_categories WHERE id = $1', [CATEGORY[kind]]);
    if (!cat.rows[0]) throw new Error('Catégorie de règlement absente : appliquez la migration 319.');
    const mm = String(month).padStart(2, '0');
    const payment = await paymentRepository.create({
      reference: `${kind.toUpperCase()}-${year}${mm}${d.reference ? `-${d.reference}` : ''}`.slice(0, 50),
      type: 'expense',
      categoryId: CATEGORY[kind],
      amount,
      paymentMethod: input.paymentMethod,
      paymentDate: input.paymentDate,
      description: `${LABEL[kind]} — paie ${mm}/${year}`,
      createdBy: input.userId,
      storeId: input.storeId,
    } as Parameters<typeof paymentRepository.create>[0]);
    const r = await db.query(
      `UPDATE payroll_declarations SET status = 'paid', payment_id = $4, paid_at = $5, paid_by = $6
        WHERE kind = $1 AND year = $2 AND month = $3 RETURNING *`,
      [kind, year, month, payment.id, input.paymentDate, input.userId]
    );
    return r.rows[0];
  },
};
