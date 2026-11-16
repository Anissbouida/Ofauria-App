/**
 * G0-12 — livre de paie : les totaux du livre égalent la somme des bulletins du
 * mois, et l'édition (PDF, Excel) se génère.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, TEST_DATABASE_URL, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Livre de paie (G0-12)', () => {
  const p = () => testPool();
  let svc: typeof import('../../services/payroll-book.service.js');
  let storeId: string;
  const ids: string[] = [];
  const YEAR = 2032;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
    svc = await import('../../services/payroll-book.service.js');
    storeId = (await p().query(`INSERT INTO stores (name, city) VALUES ($1,'T') RETURNING id`, [`Livre ${RUN}`])).rows[0].id;
    const emp = async (first: string, cnss: string) => {
      const id = (await p().query(
        `INSERT INTO employees (first_name, last_name, role, hire_date, monthly_salary, cnss_number, store_id) VALUES ($1,$2,'baker','2025-01-01',5000,$3,$4) RETURNING id`,
        [first, `G012 ${RUN}`, cnss, storeId])).rows[0].id as string;
      ids.push(id);
      return id;
    };
    const slip = (e: string, month: number, v: number[]) => p().query(
      `INSERT INTO payroll (employee_id, month, year, base_salary, worked_days, overtime_amount, bonuses, gross_salary,
                            cnss_employee, amo_employee, cimr_employee, ir_net, advance_deduction, net_salary)
       VALUES ($1,$2,$3,$4,26,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [e, month, YEAR, ...v]);
    const a = await emp('Amal', '111'), b = await emp('Badr', '222');
    //                 base  h.sup primes brut    cnss    amo    cimr ir     avances net
    await slip(a, 3, [5000, 120.5, 300, 5420.5, 242.83, 122.5, 0, 310.17, 500, 4245]);
    await slip(b, 3, [4000, 0, 0, 4000, 179.2, 90.4, 0, 0.1, 0, 3730.3]);
    await slip(a, 4, [5000, 0, 0, 5000, 224, 113, 0, 250, 0, 4413]);
  });

  afterAll(async () => {
    await p().query(`DELETE FROM payroll WHERE employee_id = ANY($1)`, [ids]).catch(() => undefined);
    await p().query(`DELETE FROM employees WHERE id = ANY($1)`, [ids]).catch(() => undefined);
    await p().query(`DELETE FROM stores WHERE id = $1`, [storeId]).catch(() => undefined);
    await closeTestPool();
  });

  it('les totaux du mois égalent la somme des bulletins', async () => {
    const book = await svc.loadPayrollBook({ year: YEAR, month: 3, storeId });
    const mine = book.months[0].lines.filter(l => ids.includes(l.employee_id));
    expect(mine).toHaveLength(2);
    expect(mine.map(l => l.cnss_number)).toEqual(['111', '222']);
    const db = (await p().query(
      `SELECT SUM(gross_salary)::float8 AS gross, SUM(net_salary)::float8 AS net, SUM(cnss_employee)::float8 AS cnss, SUM(ir_net)::float8 AS ir
         FROM payroll WHERE employee_id = ANY($1) AND month = 3 AND year = $2`, [ids, YEAR])).rows[0];
    const sum = (k: 'gross' | 'net' | 'cnss' | 'ir') => Math.round(mine.reduce((s, l) => s + l[k], 0) * 100) / 100;
    expect(sum('gross')).toBe(9420.5);
    expect(sum('gross')).toBeCloseTo(db.gross, 2);
    expect(sum('net')).toBeCloseTo(db.net, 2);
    expect(sum('cnss')).toBeCloseTo(db.cnss, 2);
    expect(sum('ir')).toBeCloseTo(db.ir, 2); // 310,17 + 0,10 : pas d'erreur d'arrondi flottant
    // Le total du livre est la somme de SES lignes.
    for (const k of svc.BOOK_AMOUNTS) {
      expect(book.months[0].totals[k]).toBeCloseTo(book.months[0].lines.reduce((s, l) => s + l[k], 0), 2);
    }
  });

  it('livre annuel : un sous-total par mois, total général cohérent', async () => {
    const book = await svc.loadPayrollBook({ year: YEAR, storeId });
    expect(book.months.map(m => m.month)).toEqual([3, 4]);
    expect(book.totals.net).toBeCloseTo(book.months.reduce((s, m) => s + m.totals.net, 0), 2);
    const edition = svc.payrollBookEdition(book);
    expect(edition.orientation).toBe('landscape');
    expect(edition.rows.filter(r => r.kind === 'subtotal')).toHaveLength(2);
    expect(edition.rows[edition.rows.length - 1].kind).toBe('total');
  });

  it('l\'édition se génère en PDF et en Excel', async () => {
    const { renderPdf, renderXlsx } = await import('../../services/ledger-editions.service.js');
    const edition = svc.payrollBookEdition(await svc.loadPayrollBook({ year: YEAR, month: 3, storeId }));
    const ctx = { legal: { name: 'Société test' } as never, author: 'Test', generatedAt: new Date(), chain: null };
    const pdf = await renderPdf(edition, ctx);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const xlsx = await renderXlsx(edition, ctx);
    expect(xlsx.subarray(0, 2).toString('latin1')).toBe('PK');
  });
});
