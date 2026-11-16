/**
 * G0-11 — à la génération de la paie, un salarié sous le SMIG du barème en
 * vigueur reçoit une alerte sur son bulletin (mode « avertir », le défaut).
 * Le mode « bloquer » est couvert par smig.test.ts (fonction pure) pour ne pas
 * modifier le réglage global de la base de test partagée.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, TEST_DATABASE_URL, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Alerte SMIG sur le bulletin (G0-11)', () => {
  const p = () => testPool();
  let payrollRepository: typeof import('../../repositories/employee.repository.js')['payrollRepository'];
  let low: string, ok: string, scaleId: string, before: { smig_monthly: string | null };
  const MONTH = 9, YEAR = 2026;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
    ({ payrollRepository } = await import('../../repositories/employee.repository.js'));
    const scale = (await p().query(
      `SELECT id, smig_monthly FROM payroll_tax_scales WHERE effective_from <= '2026-09-01' AND (effective_to IS NULL OR effective_to >= '2026-09-01') ORDER BY effective_from DESC LIMIT 1`)).rows[0];
    scaleId = scale.id; before = { smig_monthly: scale.smig_monthly };
    const emp = (name: string, salary: number) => p().query(
      `INSERT INTO employees (first_name, last_name, role, hire_date, monthly_salary, pay_frequency) VALUES ($1,$2,'baker','2025-01-01',$3,'monthly') RETURNING id`,
      [name, `G011 ${RUN}`, salary]);
    low = (await emp('Sous', 2500)).rows[0].id;
    ok = (await emp('Dessus', 6000)).rows[0].id;
  });

  afterAll(async () => {
    await p().query(`UPDATE payroll_tax_scales SET smig_monthly = $2 WHERE id = $1`, [scaleId, before.smig_monthly]).catch(() => undefined);
    const ids = [low, ok];
    await p().query(`DELETE FROM payroll_lines WHERE payroll_id IN (SELECT id FROM payroll WHERE employee_id = ANY($1))`, [ids]).catch(() => undefined);
    await p().query(`DELETE FROM payroll WHERE employee_id = ANY($1)`, [ids]).catch(() => undefined);
    await p().query(`DELETE FROM employees WHERE id = ANY($1)`, [ids]).catch(() => undefined);
    await closeTestPool();
  });

  const alertOf = async (id: string) => (await p().query(
    `SELECT smig_alert FROM payroll WHERE employee_id = $1 AND month = $2 AND year = $3`, [id, MONTH, YEAR])).rows[0]?.smig_alert;

  it('sans SMIG saisi dans le barème : aucun contrôle', async () => {
    await p().query(`UPDATE payroll_tax_scales SET smig_monthly = NULL WHERE id = $1`, [scaleId]);
    await payrollRepository.generate(MONTH, YEAR);
    expect(await alertOf(low)).toBeNull();
  }, 120_000);

  it('SMIG saisi : le bulletin sous le minimum porte l\'alerte, l\'autre non', async () => {
    await p().query(`UPDATE payroll_tax_scales SET smig_monthly = 3200 WHERE id = $1`, [scaleId]);
    await payrollRepository.generate(MONTH, YEAR);
    expect(await alertOf(low)).toMatch(/sous le SMIG mensuel/);
    expect(await alertOf(ok)).toBeNull();
  }, 120_000);

  it('salaire relevé : l\'alerte disparaît à la génération suivante', async () => {
    await p().query(`UPDATE employees SET monthly_salary = 3300 WHERE id = $1`, [low]);
    await payrollRepository.generate(MONTH, YEAR);
    expect(await alertOf(low)).toBeNull();
  }, 120_000);
});
