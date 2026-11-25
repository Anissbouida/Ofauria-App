/**
 * Plan d'action compta, étapes 1 et 2 (audit C-01) :
 *  - un mode de règlement inconnu est refusé au lieu d'être imputé en caisse ;
 *  - un avoir fournisseur déduit d'un règlement réduit la dette, la charge et la TVA
 *    récupérable, sans jamais toucher la trésorerie.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Avoir fournisseur déduit et mode de règlement inconnu (audit C-01)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let gen: typeof import('../../services/journal-generator.service.js');
  let supplierId = '', invoiceId = '', categoryId = '';
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    gen = await import('../../services/journal-generator.service.js');
    supplierId = (await p().query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`Fournisseur avoir ${RUN}`])).rows[0].id;
    // Catégorie de charge rattachée à 61121 : la résolution du compte n'a plus de repli silencieux.
    categoryId = (await p().query(
      `INSERT INTO expense_categories (name, type, account_id)
       VALUES ($1, 'expense', (SELECT id FROM accounts WHERE code = '61121')) RETURNING id`, [`Matières avoir ${RUN}`])).rows[0].id;
    invoiceId = (await p().query(
      `INSERT INTO invoices (invoice_number, invoice_type, supplier_id, invoice_date, amount, tax_amount, total_amount, category_id)
       VALUES ($1, 'received', $2, CURRENT_DATE, 1000, 200, 1200, $3) RETURNING id`, [`AVOIR-${RUN}`, supplierId, categoryId])).rows[0].id;
    await p().query(
      `INSERT INTO invoice_items (invoice_id, quantity, unit_price, subtotal, tva_rate, tva_amount, category_id)
       VALUES ($1, 1, 1000, 1000, 20, 200, $2)`, [invoiceId, categoryId]);
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM invoice_items WHERE invoice_id = $1`, [invoiceId]).catch(() => undefined);
    await p().query(`DELETE FROM invoices WHERE id = $1`, [invoiceId]).catch(() => undefined);
    await p().query(`DELETE FROM suppliers WHERE id = $1`, [supplierId]).catch(() => undefined);
    await p().query(`DELETE FROM expense_categories WHERE id = $1`, [categoryId]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  const payment = (over: Record<string, unknown>) => ({
    id: '00000000-0000-0000-0000-0000000000a1', type: 'invoice', amount: '600', payment_method: 'avoir',
    payment_date: '2026-11-10', invoice_id: invoiceId, supplier_id: supplierId, store_id: null, ...over,
  }) as never;

  const sum = (lines: Array<{ debit: number; credit: number }>, side: 'debit' | 'credit') =>
    Math.round(lines.reduce((t, l) => t + l[side], 0) * 100) / 100;

  it('avoir de 600 sur une facture de 1 200 TTC : dette, charge et TVA réduites au prorata, pas de caisse', async () => {
    const entry = await gen.fromPaymentEmission(repos.db, payment({}));
    expect(entry).not.toBeNull();
    const lines = entry!.lines;
    expect(entry!.journal_code).toBe('AC');
    expect(lines.find(l => l.account_code === '4411')).toMatchObject({ debit: 600, credit: 0 });
    expect(lines.find(l => l.account_code === '34552')).toMatchObject({ debit: 0, credit: 100 });
    const charge = lines.filter(l => l.credit > 0 && l.account_code !== '34552');
    expect(charge).toHaveLength(1);
    expect(charge[0]).toMatchObject({ account_code: '61121', credit: 500 });
    expect(lines.some(l => ['5161', '5141', '5111'].includes(l.account_code))).toBe(false);
    expect(sum(lines, 'debit')).toBe(sum(lines, 'credit'));
  });

  it('avoir égal au total de la facture : tout est repris, écriture équilibrée', async () => {
    const entry = await gen.fromPaymentEmission(repos.db, payment({ amount: '1200' }));
    expect(sum(entry!.lines, 'debit')).toBe(1200);
    expect(sum(entry!.lines, 'credit')).toBe(1200);
    expect(entry!.lines.find(l => l.account_code === '34552')?.credit).toBe(200);
  });

  it('avoir supérieur à la facture : refusé', async () => {
    await expect(gen.fromPaymentEmission(repos.db, payment({ amount: '1300' })))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_AVOIR' });
  });

  it('avoir sans facture fournisseur : refusé', async () => {
    await expect(gen.fromPaymentEmission(repos.db, payment({ invoice_id: null })))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_AVOIR' });
  });

  it('mode de règlement inconnu : refusé, jamais imputé en caisse', async () => {
    await expect(gen.fromPaymentEmission(repos.db, payment({ payment_method: 'bitcoin' })))
      .rejects.toMatchObject({ statusCode: 422, code: 'UNSUPPORTED_PAYMENT_METHOD' });
  });

  it('les modes connus gardent leur compte', () => {
    expect(gen.paymentMethodPosting('cash').out).toBe('5161');
    expect(gen.paymentMethodPosting('card').out).toBe('5141');
    expect(gen.paymentMethodPosting('check').out).toBe('5111');
    expect(gen.paymentMethodPosting('traite')).toMatchObject({ out: '4415', in: '5113' });
    expect(() => gen.paymentMethodPosting(undefined)).toThrow(/non pris en charge/);
  });
});
