/**
 * G0-13 — barème de paie versionné : une nouvelle loi de finances crée une
 * version datée ; le barème d'une date passée ne change pas, donc l'IR d'un
 * bulletin de l'an passé recalculé reste le même. Un barème déjà utilisé par un
 * bulletin n'est plus modifiable dans ses valeurs de calcul.
 *
 * Dates lointaines (2090) : les autres suites, qui calculent des paies de
 * 2026-2032, ne voient jamais la version créée ici.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, TEST_DATABASE_URL, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Barème de paie versionné (G0-13)', () => {
  const p = () => testPool();
  let taxScaleRepository: typeof import('../../repositories/payroll-config.repository.js')['taxScaleRepository'];
  let prev: { id: string; effective_to: string | null };
  let employeeId: string;
  const created: string[] = [];
  const NEW_FROM = '2090-01-01';

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
    ({ taxScaleRepository } = await import('../../repositories/payroll-config.repository.js'));
    const cur = (await p().query(`SELECT id, effective_to::text FROM payroll_tax_scales WHERE effective_from < $1 ORDER BY effective_from DESC LIMIT 1`, [NEW_FROM])).rows[0];
    prev = { id: cur.id, effective_to: cur.effective_to };
    employeeId = (await p().query(`INSERT INTO employees (first_name, last_name, role, hire_date, monthly_salary) VALUES ('Bareme',$1,'baker','2025-01-01',6000) RETURNING id`, [`G013 ${RUN}`])).rows[0].id;
  });

  afterAll(async () => {
    await p().query(`DELETE FROM payroll WHERE employee_id = $1`, [employeeId]).catch(() => undefined);
    await p().query(`DELETE FROM employees WHERE id = $1`, [employeeId]).catch(() => undefined);
    await p().query(`DELETE FROM payroll_tax_scales WHERE id = ANY($1)`, [created]).catch(() => undefined);
    await p().query(`UPDATE payroll_tax_scales SET effective_to = $2::date WHERE id = $1`, [prev.id, prev.effective_to]).catch(() => undefined);
    await closeTestPool();
  });

  it('crée une version datée, copie du barème précédent, et clôt celui-ci la veille', async () => {
    const before = await taxScaleRepository.findForDate('2089-06-15');
    const v = await taxScaleRepository.createVersion({ effectiveFrom: NEW_FROM, label: `LF 2090 ${RUN}` });
    created.push(v.id);
    expect(String(v.cnss_plafond)).toBe(String(before.cnss_plafond));
    expect(JSON.stringify(v.ir_brackets)).toBe(JSON.stringify(before.ir_brackets));
    const old = (await p().query(`SELECT effective_to::text FROM payroll_tax_scales WHERE id = $1`, [prev.id])).rows[0];
    expect(old.effective_to).toBe('2089-12-31');
    // Une seconde version à la même date est refusée.
    await expect(taxScaleRepository.createVersion({ effectiveFrom: NEW_FROM })).rejects.toThrow(/déjà à cette date/);
  });

  it('modifier la nouvelle version ne change pas le barème d\'une date passée', async () => {
    const before = await taxScaleRepository.findForDate('2089-06-15');
    await taxScaleRepository.update(created[0], { cnssPlafond: 9999, irBrackets: [{ upTo: null, rate: 0.5, deduction: 0 }] });
    const past = await taxScaleRepository.findForDate('2089-06-15');
    expect(past.id).toBe(prev.id);
    expect(String(past.cnss_plafond)).toBe(String(before.cnss_plafond));
    expect(JSON.stringify(past.ir_brackets)).toBe(JSON.stringify(before.ir_brackets));
    // La date nouvelle lit bien la nouvelle version.
    const now = await taxScaleRepository.findForDate('2090-03-01');
    expect(now.id).toBe(created[0]);
    expect(Number(now.cnss_plafond)).toBe(9999);
  });

  it('un barème utilisé par un bulletin est verrouillé, sauf libellé, notes et SMIG', async () => {
    await p().query(
      `INSERT INTO payroll (employee_id, month, year, base_salary, net_salary, tax_scale_id) VALUES ($1, 2, 2090, 6000, 5000, $2)`, [employeeId, created[0]]);
    await expect(taxScaleRepository.update(created[0], { cnssPlafond: 7000 })).rejects.toThrow(/nouvelle version/);
    await expect(taxScaleRepository.update(created[0], { irBrackets: [{ upTo: null, rate: 0.1, deduction: 0 }] })).rejects.toThrow(/nouvelle version/);
    const ok = await taxScaleRepository.update(created[0], { label: `LF 2090 corrigée ${RUN}`, smigMonthly: 3500 });
    expect(ok.label).toContain('corrigée');
    expect(Number(ok.smig_monthly)).toBe(3500);
    expect(Number(ok.cnss_plafond)).toBe(9999);
    expect((await taxScaleRepository.list()).find((s: { id: string }) => s.id === created[0]).payslip_count).toBe(1);
  });
});
