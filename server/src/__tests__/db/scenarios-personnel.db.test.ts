/**
 * Scénarios réalistes — GESTION DU PERSONNEL / PAIE (intégration base migrée).
 *
 * On joue le gérant RH + l'admin paie d'une boulangerie :
 *   1. Embauche    : le RIB saisi est persisté ; le RIB reste optionnel.
 *   2. Avance      : plafonnée au salaire mensuel équivalent diminué des avances
 *                    en cours (refus 409 au-delà), côté gérant.
 *   3. Planning    : une assignation sur un jour de congé approuvé est pré-exclue
 *                    (pas de rejet global) ; les autres jours sont planifiés, les
 *                    jours ignorés renvoyés.
 *   4. Paie        : bulletin mensuel des hebdo déclarés ; tolérance d'arrondi des
 *                    acomptes (trop-perçu de 0,01 toléré) ; vrai trop-perçu bloqué.
 *   5. Pointage    : jours non pointés retenus (prorata base 26) sur le mensuel.
 *   6. CNSS        : déclaration refusée tant qu'un salarié n'a pas de n° CNSS.
 *
 * Toute la paie/période/déclaration se joue sur l'année 2099 (isolée) et, par
 * scénario, sur un mois distinct, pour ne pas entrer en collision avec les
 * suites qui tournent en parallèle.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, cleanupFixtures, num, RUN, type Fixtures,
} from './helpers.js';
import { ribKey } from '../../services/salary-transfer.js';

const YEAR = 2099;
// Un mois distinct par scénario paie -> pas de collision sur payroll_periods.
const M_CNSS = 1;     // déclaration CNSS
const M_PRORATA = 3;  // jours non pointés (mensuel)
const M_WEEKLY = 7;   // bulletin mensuel des hebdo déclarés
const M_TOL = 8;      // tolérance d'arrondi / trop-perçu

// Juillet 2099 : lundis 06/13 (jeudi en juillet). Août 2099 : lundi 03 (jeudi 06).
const SHIFT = `SC-${RUN}`.slice(0, 20);

/* eslint-disable @typescript-eslint/no-explicit-any */
function fakeRes() {
  let code = 200;
  const captured: { status: number; body: any } = { status: 200, body: null };
  const res: any = {
    status(c: number) { code = c; captured.status = c; return this; },
    json(b: any) { captured.body = b; captured.status = code; return this; },
  };
  return { res, captured };
}

describe.skipIf(!hasTestDb)('Scénarios RH / Paie (2099)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let employeeRepository: typeof import('../../repositories/employee.repository.js').employeeRepository;
  let scheduleRepository: typeof import('../../repositories/employee.repository.js').scheduleRepository;
  let payrollRepository: typeof import('../../repositories/employee.repository.js').payrollRepository;
  let salaryAdvanceRepository: typeof import('../../repositories/salary-advance.repository.js').salaryAdvanceRepository;
  let payrollDeclarationRepository: typeof import('../../repositories/payroll-declarations.repository.js').payrollDeclarationRepository;
  let salaryAdvanceController: any;
  let fx: Fixtures;

  const emps: string[] = [];
  const addEmp = async (sql: string, params: unknown[]): Promise<string> => {
    const r = await testPool().query(sql, params);
    emps.push(r.rows[0].id);
    return r.rows[0].id;
  };

  // Salariés
  let empRibOui: string; let empRibNon: string;              // embauche
  let empMensuelCap: string; let empHebdoCap: string;        // avance
  let empConge: string; let empDispo: string;                // planning
  let empHebdoDecl: string;                                  // bulletin hebdo
  let empTol: string; let empTrop: string;                   // tolérance / trop-perçu
  let empPro: string;                                        // prorata pointage
  let empCnssOk: string; let empCnssKo: string;              // déclaration CNSS

  const first22 = '2307800012345678901234';
  const validRib = first22 + ribKey(first22);

  const clearPeriods = async () => {
    const p = testPool();
    for (const m of [M_CNSS, M_PRORATA, M_WEEKLY, M_TOL]) {
      await p.query(`DELETE FROM payroll_declarations WHERE year = $1 AND month = $2`, [YEAR, m]).catch(() => undefined);
      await p.query(`DELETE FROM payroll_periods WHERE year = $1 AND month = $2`, [YEAR, m]).catch(() => undefined);
    }
  };

  beforeAll(async () => {
    repos = await importRepositories();
    const empMod = await import('../../repositories/employee.repository.js');
    employeeRepository = empMod.employeeRepository;
    scheduleRepository = empMod.scheduleRepository;
    payrollRepository = empMod.payrollRepository;
    salaryAdvanceRepository = (await import('../../repositories/salary-advance.repository.js')).salaryAdvanceRepository;
    payrollDeclarationRepository = (await import('../../repositories/payroll-declarations.repository.js')).payrollDeclarationRepository;
    salaryAdvanceController = (await import('../../controllers/employee.controller.js')).salaryAdvanceController;

    fx = await createBaseFixtures();
    const p = testPool();
    await clearPeriods();

    // ── Avance : un mensuel 6000 et un hebdo 600 (équiv. mensuel 2600) ──
    empMensuelCap = await addEmp(
      `INSERT INTO employees (first_name, last_name, role, hire_date, pay_frequency, monthly_salary, store_id)
       VALUES ('Khadija', 'Mensuel ${RUN}', 'cashier', '2099-01-01', 'monthly', 6000, $1) RETURNING id`, [fx.storeId]);
    empHebdoCap = await addEmp(
      `INSERT INTO employees (first_name, last_name, role, hire_date, pay_frequency, weekly_salary, store_id)
       VALUES ('Brahim', 'Hebdo ${RUN}', 'baker', '2099-01-01', 'weekly', 600, $1) RETURNING id`, [fx.storeId]);
    // Avance déjà en cours de 5500 DH sur le mensuel -> plafond restant = 500.
    await p.query(
      `INSERT INTO salary_advances (employee_id, amount, advance_date, payment_method, remaining_amount, status, store_id)
       VALUES ($1, 5500, CURRENT_DATE, 'cash', 5500, 'partial', $2)`, [empMensuelCap, fx.storeId]);

    // ── Planning : un salarié en congé, un disponible ──
    empConge = await addEmp(
      `INSERT INTO employees (first_name, last_name, role, hire_date, store_id)
       VALUES ('Fatima', 'Conge ${RUN}', 'cashier', '2099-01-01', $1) RETURNING id`, [fx.storeId]);
    empDispo = await addEmp(
      `INSERT INTO employees (first_name, last_name, role, hire_date, store_id)
       VALUES ('Omar', 'Dispo ${RUN}', 'cashier', '2099-01-01', $1) RETURNING id`, [fx.storeId]);
    await p.query(`INSERT INTO shifts (code, label, start_time, end_time) VALUES ($1, 'Matin', '07:00', '14:00')`, [SHIFT]);
    await p.query(
      `INSERT INTO leaves (employee_id, type, start_date, end_date, days, status)
       VALUES ($1, 'annual', '2099-04-06', '2099-04-06', 1, 'approved')`, [empConge]);

    // ── Paie : hebdo déclaré avec 2 semaines payées en juillet (acomptes) ──
    empHebdoDecl = await addEmp(
      `INSERT INTO employees (first_name, last_name, role, hire_date, pay_frequency, weekly_salary, is_declared, store_id)
       VALUES ('Nadia', 'HebdoDecl ${RUN}', 'baker', '2099-01-01', 'weekly', 700, true, $1) RETURNING id`, [fx.storeId]);
    for (const wk of ['2099-07-06', '2099-07-13']) {
      await p.query(
        `INSERT INTO weekly_payroll (employee_id, week_start, week_end, base_amount, net_amount, worked_days, withholding_amount, paid, paid_at)
         VALUES ($1, $2, ($2::date + 6), 700, 700, 6, 20, true, NOW())`, [empHebdoDecl, wk]);
    }

    // ── Tolérance d'arrondi (0,01 toléré) et vrai trop-perçu (60 DH) ──
    empTol = await addEmp(
      `INSERT INTO employees (first_name, last_name, role, hire_date, pay_frequency, weekly_salary, is_declared, store_id)
       VALUES ('Salma', 'Tol ${RUN}', 'cashier', '2099-01-01', 'weekly', 500, true, $1) RETURNING id`, [fx.storeId]);
    empTrop = await addEmp(
      `INSERT INTO employees (first_name, last_name, role, hire_date, pay_frequency, weekly_salary, is_declared, store_id)
       VALUES ('Rachid', 'Trop ${RUN}', 'cashier', '2099-01-01', 'weekly', 500, true, $1) RETURNING id`, [fx.storeId]);
    // Semaine payée (jeudi 06/08 en août) : net 500, retenue provisoire 10.
    await p.query(
      `INSERT INTO weekly_payroll (employee_id, week_start, week_end, base_amount, net_amount, worked_days, withholding_amount, paid, paid_at)
       VALUES ($1, '2099-08-03', '2099-08-09', 500, 500, 6, 10, true, NOW())`, [empTol]);
    await p.query(
      `INSERT INTO weekly_payroll (employee_id, week_start, week_end, base_amount, net_amount, worked_days, withholding_amount, paid, paid_at)
       VALUES ($1, '2099-08-03', '2099-08-09', 440, 500, 6, 10, true, NOW())`, [empTrop]);

    // ── Prorata pointage : mensuel non déclaré 7800, pointé 24 j sur mars ──
    empPro = await addEmp(
      `INSERT INTO employees (first_name, last_name, role, hire_date, pay_frequency, monthly_salary, is_declared, store_id)
       VALUES ('Hassan', 'Prorata ${RUN}', 'baker', '2099-01-01', 'monthly', 7800, false, $1) RETURNING id`, [fx.storeId]);
    // 24 jours de présence RÉELLE (is_expected = false) -> 2 jours non pointés sur base 26.
    for (let d = 1; d <= 24; d++) {
      await p.query(
        `INSERT INTO attendance (employee_id, date, status, is_expected)
         VALUES ($1, $2, 'present', false)`,
        [empPro, `2099-03-${String(d).padStart(2, '0')}`]);
    }

    // ── Déclaration CNSS : un avec numéro, un sans ──
    empCnssOk = await addEmp(
      `INSERT INTO employees (first_name, last_name, role, hire_date, cnss_number, store_id)
       VALUES ('Leila', 'CnssOk ${RUN}', 'cashier', '2099-01-01', '1122334', $1) RETURNING id`, [fx.storeId]);
    empCnssKo = await addEmp(
      `INSERT INTO employees (first_name, last_name, role, hire_date, cnss_number, store_id)
       VALUES ('Youssef', 'CnssKo ${RUN}', 'cashier', '2099-01-01', NULL, $1) RETURNING id`, [fx.storeId]);
    for (const empId of [empCnssOk, empCnssKo]) {
      await p.query(
        `INSERT INTO payroll (employee_id, month, year, gross_salary, worked_days, is_declared)
         VALUES ($1, $2, $3, 5000, 26, true)`, [empId, M_CNSS, YEAR]);
    }
    await p.query(`INSERT INTO payroll_periods (year, month, status) VALUES ($1, $2, 'closed')`, [YEAR, M_CNSS]);
  }, 120_000);

  afterAll(async () => {
    const p = testPool();
    const run = async (sql: string, params: unknown[]) => { try { await p.query(sql, params); } catch { /* best effort */ } };
    await clearPeriods();
    // Dépendances paie/avances/pointage pour tous mes salariés.
    await run(`DELETE FROM salary_advance_repayments WHERE advance_id IN (SELECT id FROM salary_advances WHERE employee_id = ANY($1::uuid[]))`, [emps]);
    await run(`DELETE FROM salary_advances WHERE employee_id = ANY($1::uuid[])`, [emps]);
    await run(`DELETE FROM payments WHERE employee_id = ANY($1::uuid[])`, [emps]);
    await run(`DELETE FROM payroll WHERE employee_id = ANY($1::uuid[])`, [emps]);
    await run(`DELETE FROM weekly_payroll WHERE employee_id = ANY($1::uuid[])`, [emps]);
    await run(`DELETE FROM attendance WHERE employee_id = ANY($1::uuid[])`, [emps]);
    await run(`DELETE FROM schedules WHERE employee_id = ANY($1::uuid[])`, [emps]);
    await run(`DELETE FROM leaves WHERE employee_id = ANY($1::uuid[])`, [emps]);
    await run(`DELETE FROM shifts WHERE code = $1`, [SHIFT]);
    await run(`DELETE FROM employees WHERE id = ANY($1::uuid[])`, [emps]);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  }, 120_000);

  // ─── 1. Embauche : le RIB saisi est persisté, le RIB reste optionnel ───
  describe('Embauche', () => {
    it('persiste le RIB saisi (24 chiffres) sur la fiche du salarié', async () => {
      const emp = await employeeRepository.create({
        firstName: 'Imane', lastName: `RibOui ${RUN}`, role: 'cashier',
        hireDate: '2099-01-01', storeId: fx.storeId, rib: validRib, bankName: 'Attijariwafa',
      });
      empRibOui = emp.id; emps.push(emp.id);
      const row = await testPool().query('SELECT rib, bank_name FROM employees WHERE id = $1', [emp.id]);
      expect(row.rows[0].rib).toBe(validRib);
      expect(row.rows[0].bank_name).toBe('Attijariwafa');
    });

    it('accepte une embauche sans RIB (champ optionnel) -> rib NULL', async () => {
      const emp = await employeeRepository.create({
        firstName: 'Said', lastName: `RibNon ${RUN}`, role: 'cashier',
        hireDate: '2099-01-01', storeId: fx.storeId,
      });
      empRibNon = emp.id; emps.push(emp.id);
      const row = await testPool().query('SELECT rib FROM employees WHERE id = $1', [emp.id]);
      expect(row.rows[0].rib).toBeNull();
    });
  });

  // ─── 2. Avance sur salaire plafonnée (côté gérant) ───
  describe('Avance sur salaire (gérant)', () => {
    it('refuse (409) une avance qui dépasse le plafond restant (avances en cours)', async () => {
      // Mensuel 6000, 5500 déjà en cours -> reste 500. Demande 1000 -> refus.
      const before = await salaryAdvanceRepository.list({ employeeId: empMensuelCap });
      const { res, captured } = fakeRes();
      await salaryAdvanceController.create(
        { body: { employeeId: empMensuelCap, amount: 1000 }, user: { userId: fx.userId, storeId: fx.storeId } } as any,
        res,
      );
      expect(captured.status).toBe(409);
      expect(captured.body.success).toBe(false);
      // Aucune nouvelle avance n'a été créée.
      const after = await salaryAdvanceRepository.list({ employeeId: empMensuelCap });
      expect(after.length).toBe(before.length);
    });

    it('refuse (409) une avance aberrante sur un hebdo (équivalent mensuel = hebdo x52/12)', async () => {
      // 600/sem -> ~2600 équiv. mensuel ; 50 000 DH -> refus.
      const { res, captured } = fakeRes();
      await salaryAdvanceController.create(
        { body: { employeeId: empHebdoCap, amount: 50000 }, user: { userId: fx.userId, storeId: fx.storeId } } as any,
        res,
      );
      expect(captured.status).toBe(409);
    });

    it('accorde (201) une avance dans le plafond et la persiste', async () => {
      // 600/sem -> plafond ~2600, 0 en cours : 2000 DH passe.
      const { res, captured } = fakeRes();
      await salaryAdvanceController.create(
        { body: { employeeId: empHebdoCap, amount: 2000 }, user: { userId: fx.userId, storeId: fx.storeId } } as any,
        res,
      );
      expect(captured.status).toBe(201);
      expect(captured.body.success).toBe(true);
      const row = await testPool().query(
        `SELECT amount, remaining_amount, status FROM salary_advances WHERE employee_id = $1`, [empHebdoCap]);
      expect(row.rows).toHaveLength(1);
      expect(num(row.rows[0].amount)).toBe(2000);
      expect(num(row.rows[0].remaining_amount)).toBe(2000);
    });
  });

  // ─── 3. Planning hebdo vs congé approuvé ───
  describe('Planning hebdo', () => {
    it('pré-exclut le jour en congé, planifie les autres, renvoie les jours ignorés', async () => {
      const D = '2099-04-06';
      const res = await scheduleRepository.bulkUpsertWeek([
        { employeeId: empConge, date: D, shiftCode: SHIFT },
        { employeeId: empDispo, date: D, shiftCode: SHIFT },
      ]);
      expect(res.conflicts).toContain(`${empConge}@${D}`);
      expect(res.conflicts).not.toContain(`${empDispo}@${D}`);
      expect(res.updated).toBe(1); // seul le salarié disponible est planifié

      const p = testPool();
      const sConge = await p.query(`SELECT 1 FROM schedules WHERE employee_id = $1 AND date = $2`, [empConge, D]);
      const sDispo = await p.query(`SELECT 1 FROM schedules WHERE employee_id = $1 AND date = $2`, [empDispo, D]);
      expect(sConge.rows).toHaveLength(0); // en congé : non planifié
      expect(sDispo.rows).toHaveLength(1); // planifié
    });
  });

  // ─── 4. Paie : bulletin mensuel des hebdo déclarés + tolérance / trop-perçu ───
  describe('Paie mensuelle', () => {
    it('génère le bulletin mensuel d un hebdo déclaré en cumulant les acomptes', async () => {
      const { payrolls } = await payrollRepository.generate(M_WEEKLY, YEAR, fx.storeId);
      expect(Array.isArray(payrolls)).toBe(true);
      const row = (await testPool().query(
        `SELECT pay_frequency, acomptes_amount FROM payroll WHERE employee_id = $1 AND month = $2 AND year = $3`,
        [empHebdoDecl, M_WEEKLY, YEAR])).rows[0];
      expect(row).toBeTruthy();
      expect(row.pay_frequency).toBe('weekly');
      // 2 semaines à 700 nets versées -> acomptes du mois = 1400.
      expect(num(row.acomptes_amount)).toBeCloseTo(1400, 2);
    });

    it('tolère un dépassement d arrondi de 0,01 DH : le bulletin se paie sans décaissement', async () => {
      // net_salary 499,99 ; acomptes 500 -> net -0,01 (toléré, pas de cashOut).
      const pr = (await testPool().query(
        `INSERT INTO payroll (employee_id, month, year, pay_frequency, net_salary, acomptes_amount, paid)
         VALUES ($1, $2, $3, 'weekly', 499.99, 500, false) RETURNING id`,
        [empTol, M_TOL, YEAR])).rows[0];
      const r = await payrollRepository.markPaid(pr.id, 'cash', fx.userId, fx.storeId);
      expect(r).toBeTruthy();
      expect(r.paid).toBe(true);
      const pay = await testPool().query(
        `SELECT COUNT(*)::int AS n FROM payments WHERE employee_id = $1 AND type = 'salary'`, [empTol]);
      expect(num(pay.rows[0].n)).toBe(0); // net négatif d'un centime -> aucun décaissement
    });

    it('bloque un vrai trop-perçu (60 DH) sur le bulletin mensuel', async () => {
      // net_salary 440 ; acomptes 500 -> net -60 : refus.
      const pr = (await testPool().query(
        `INSERT INTO payroll (employee_id, month, year, pay_frequency, net_salary, acomptes_amount, paid)
         VALUES ($1, $2, $3, 'weekly', 440, 500, false) RETURNING id`,
        [empTrop, M_TOL, YEAR])).rows[0];
      await expect(payrollRepository.markPaid(pr.id, 'cash', fx.userId, fx.storeId))
        .rejects.toThrow(/trop-perçu/i);
    });
  });

  // ─── 5. Pointage : jours non pointés retenus (prorata base 26) ───
  describe('Pointage', () => {
    it('retient les jours non pointés sur le bulletin mensuel (base 26)', async () => {
      await payrollRepository.generate(M_PRORATA, YEAR, fx.storeId);
      const row = (await testPool().query(
        `SELECT worked_days, absent_days, deductions, net_salary, base_salary
           FROM payroll WHERE employee_id = $1 AND month = $2 AND year = $3`,
        [empPro, M_PRORATA, YEAR])).rows[0];
      expect(row).toBeTruthy();
      // 24 jours pointés sur 26 -> 2 jours retenus ; taux jour = 7800/26 = 300.
      expect(num(row.worked_days)).toBe(24);
      expect(num(row.absent_days)).toBe(2);
      expect(num(row.deductions)).toBeCloseTo(600, 2);    // 2 x 300
      expect(num(row.net_salary)).toBeCloseTo(7200, 2);   // 7800 - 600 (non déclaré)
    });
  });

  // ─── 6. Déclaration CNSS : refusée si un numéro manque ───
  describe('Déclaration CNSS', () => {
    it('refuse la déclaration tant qu un salarié n a pas de numéro CNSS (nommé)', async () => {
      await expect(payrollDeclarationRepository.declare('cnss', M_CNSS, YEAR, null, fx.userId))
        .rejects.toThrow(/num[ée]ro CNSS|e-BDS|Damancom/i);
    });

    it('accepte la déclaration une fois tous les numéros renseignés', async () => {
      await testPool().query(`UPDATE employees SET cnss_number = '9988776' WHERE id = $1`, [empCnssKo]);
      const d = await payrollDeclarationRepository.declare('cnss', M_CNSS, YEAR, null, fx.userId);
      expect(d).toBeTruthy();
      expect(d.kind).toBe('cnss');
    });
  });
});
