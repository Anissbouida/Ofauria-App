/**
 * G6-06 — pack pays (mig 606) : zéro écart sur un bulletin type, valeurs du pack MA égales
 * aux anciennes constantes, repli sur le Maroc et refus des formats déclaratifs marocains
 * quand le pays de la société n'est pas MA.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, RUN, type Fixtures } from './helpers.js';

const MONEY_FIELDS = [
  'base_salary', 'worked_days', 'absent_days', 'deductions', 'seniority_rate', 'seniority_bonus', 'overtime_amount',
  'gross_salary', 'brut_imposable', 'cnss_employee', 'amo_employee', 'cimr_employee', 'frais_pro', 'net_imposable',
  'ir_gross', 'ir_net', 'net_salary', 'cnss_employer', 'amo_employer', 'cimr_employer', 'alloc_familiales', 'taxe_fp',
  'total_charges_patron',
];

describe.skipIf(!hasTestDb)('Pack pays MA — zéro écart (G6-06)', () => {
  let fx: Fixtures;
  let empId = '';
  let cfg: typeof import('../../repositories/payroll-config.repository.js');
  let pack: typeof import('../../services/country-pack.js');
  let engine: typeof import('../../services/payroll-engine.js');
  let overtime: typeof import('../../services/overtime-engine.js');

  beforeAll(async () => {
    await importRepositories();
    cfg = await import('../../repositories/payroll-config.repository.js');
    pack = await import('../../services/country-pack.js');
    engine = await import('../../services/payroll-engine.js');
    overtime = await import('../../services/overtime-engine.js');
    fx = await createBaseFixtures();
    const p = testPool();
    // Salarié déclaré, 12 ans d'ancienneté en mars 2026 (15 %), 2 enfants, CIMR 3 %.
    empId = (await p.query(
      `INSERT INTO employees (first_name, last_name, role, hire_date, pay_frequency, monthly_salary, is_active, store_id,
                              nb_dependents, cimr_rate, is_declared)
       VALUES ('Pack', $1, 'cashier', '2013-06-01', 'monthly', 9000, true, $2, 2, 3, true) RETURNING id`,
      [`G606-${RUN}`, fx.storeId])).rows[0].id;
    // Mars 2026 : 22 présents dont 3 avec 2 h sup, 2 shifts doubles, 1 absent.
    for (let d = 2; d <= 23; d++) {
      await p.query(
        `INSERT INTO attendance (employee_id, date, status, is_expected, overtime_minutes) VALUES ($1, $2::date, 'present', false, $3)`,
        [empId, `2026-03-${String(d).padStart(2, '0')}`, d <= 4 ? 120 : 0]);
    }
    await p.query(`INSERT INTO attendance (employee_id, date, status, is_expected) VALUES ($1, '2026-03-24', 'double', false), ($1, '2026-03-25', 'double', false), ($1, '2026-03-26', 'absent', false)`, [empId]);
  }, 60_000);

  afterAll(async () => {
    const p = testPool();
    const run = async (sql: string, params: unknown[]) => { try { await p.query(sql, params); } catch { /* best effort */ } };
    await run(`UPDATE module_parameters SET value = '{"code": "MA"}'::jsonb WHERE key = 'company.country_code'`, []);
    await run(`DELETE FROM payroll WHERE employee_id = $1`, [empId]);
    await run(`DELETE FROM attendance WHERE employee_id = $1`, [empId]);
    await run(`DELETE FROM employees WHERE id = $1`, [empId]);
    await run(`DELETE FROM users WHERE id = $1`, [fx.userId]);
    await run(`DELETE FROM stores WHERE id = $1`, [fx.storeId]);
    await closeTestPool();
  }, 60_000);

  it('le pack MA en base porte exactement les anciennes constantes', async () => {
    pack.clearCountryPackCache();
    expect(await pack.activeCountryCode()).toBe('MA');
    expect(await pack.countryParam('paie.base_days', '2026-03-01')).toBe(26);
    expect(await pack.countryParam('paie.legal_monthly_hours', '2026-03-01')).toBe(191);
    expect(await pack.countryParam('paie.legal_weekly_hours', '2026-03-01')).toBe(44);
    expect(await pack.countryParam('paie.ot_rates', '2026-03-01')).toEqual(overtime.DEFAULT_OT_RATES);
    expect(await pack.countryParam('paie.night_window', '2026-03-01')).toEqual({ start: '21:00', end: '06:00' });
    expect(await pack.countryParam('paie.holiday_worked_rate', '2026-03-01')).toBe(1);
    expect(await pack.countryParam('paie.ot_annual_quota_hours', '2026-03-01')).toBe(100);
    expect(await pack.countryParam('paie.seniority_brackets', '2026-03-01')).toEqual(engine.DEFAULT_SENIORITY_BRACKETS);
    expect(await pack.countryParam('fiscalite.vat_rates', '2026-03-01')).toEqual([7, 10, 14, 20]);
    // Toutes les clés du pack MA en base = valeurs intégrées (aucune divergence entre code et données).
    for (const key of Object.keys(pack.MA_DEFAULTS) as (keyof typeof pack.MA_DEFAULTS)[]) {
      expect(await pack.countryParam(key, '2026-03-01'), key).toEqual(pack.MA_DEFAULTS[key]);
    }
  });

  it('bulletin type : mêmes montants avec le pack et avec les anciennes valeurs codées en dur', async () => {
    pack.clearCountryPackCache();
    const emp = (await testPool().query(`SELECT * FROM employees WHERE id = $1`, [empId])).rows[0];
    const ctx = await cfg.loadPayrollContext(3, 2026);
    expect(ctx.seniorityBrackets).toEqual(engine.DEFAULT_SENIORITY_BRACKETS);
    const withPack = await cfg.computeAndSavePayslip(emp, 3, 2026, ctx) as Record<string, unknown>;
    // « Avant » : barème d'ancienneté intégré au moteur, base 26, 191 h, majorations 25/50/50/100 %.
    const legacy = await cfg.computeAndSavePayslip(emp, 3, 2026, {
      scale: ctx.scale, baseDays: 26,
      time: { ...ctx.time, monthlyLegalHours: 191, otRates: { day: 0.25, night: 0.5, restDay: 0.5, restNight: 1 }, holidayWorkedRate: 1 },
    }) as Record<string, unknown>;
    for (const f of MONEY_FIELDS) expect(Number(withPack[f]), f).toBe(Number(legacy[f]));
    expect(Number(withPack.seniority_rate)).toBe(0.15);
    expect(Number(withPack.seniority_bonus)).toBe(Math.round((9000 - Number(withPack.deductions)) * 0.15 * 100) / 100);
    expect(Number(withPack.overtime_amount)).toBeGreaterThan(0);
    expect(Number(withPack.cnss_employee)).toBeGreaterThan(0);
  });

  it('pays sans pack : repli sur les valeurs MA, formats déclaratifs marocains refusés (400)', async () => {
    const p = testPool();
    const { requireDeclarativeFormat } = await import('../../middleware/country-pack.middleware.js');
    try {
      await p.query(`UPDATE module_parameters SET value = '{"code": "FR"}'::jsonb WHERE key = 'company.country_code'`);
      pack.clearCountryPackCache();
      expect(await pack.activeCountryCode()).toBe('FR');
      expect(await pack.countryParam('paie.base_days')).toBe(26);
      expect((await pack.declarativeFormatAvailable('ebds')).ok).toBe(false);
      let status = 0; let body: { error?: { message?: string } } = {}; let passed = false;
      const res = { status(s: number) { status = s; return this; }, json(b: typeof body) { body = b; return this; } };
      await requireDeclarativeFormat('ebds', 'Fichier e-BDS Damancom')({} as never, res as never, () => { passed = true; });
      expect(passed).toBe(false);
      expect(status).toBe(400);
      expect(body.error?.message).toContain('pays MA seulement');
      expect(body.error?.message).toContain('FR');
    } finally {
      await p.query(`UPDATE module_parameters SET value = '{"code": "MA"}'::jsonb WHERE key = 'company.country_code'`);
      pack.clearCountryPackCache();
    }
    expect((await pack.declarativeFormatAvailable('ebds')).ok).toBe(true);
    expect((await pack.declarativeFormatAvailable('liasse')).ok).toBe(true);
  });

  it('vue lecture seule : pays, paramètres en vigueur', async () => {
    pack.clearCountryPackCache();
    const o = await pack.countryPackOverview('2026-03-01');
    expect(o.country).toBe('MA');
    expect(o.pack?.name).toBe('Maroc');
    expect(o.pack?.defaultCurrency).toBe('MAD');
    expect(o.parameters.find(x => x.key === 'paie.base_days')?.value).toBe(26);
    expect(o.parameters.length).toBe(Object.keys(pack.MA_DEFAULTS).length);
  });
});
