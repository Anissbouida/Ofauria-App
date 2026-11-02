/**
 * Impôt sur les sociétés (mig 430) — intégration base migrée.
 *
 * Exercices 2024 (N−1) et 2025 (N), réservés à ce test et remis à zéro avant
 * et après (les écritures des passages précédents restent : on vérifie des
 * écarts et des formules, pas des montants absolus) :
 *   N−1 : +100 000 de résultat, IS comptabilisé sans acompte, solde versé.
 *   N   : acomptes = 25 % de l'impôt N−1 aux taux de N ; +400 000 de résultat,
 *         réintégration 50 000, déduction 10 000 → résultat fiscal +440 000 ;
 *         charge : 6701 D (IS dû) / 3453 C (acomptes imputés) / 4453 C (reste).
 *   Garde-fous : calcul figé après comptabilisation, acompte non annulable,
 *   extourne manuelle refusée, annulation puis nouvelle comptabilisation.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';
import { computeTax } from '../../services/corporate-tax.rules.js';

describe('IS — calcul (règles)', () => {
  const P = { regime: 'standard' as const, rate_standard: 20, rate_high: 35, high_threshold: 100_000_000, rate_credit: 40, cm_rate: 0.25, cm_minimum: 3000, cm_exempt: false, cm_base_override: null };
  it('taux unique selon le seuil, régime crédit, cotisation minimale', () => {
    expect(computeTax(P, 500_000, 2_000_000)).toEqual({ rate: 20, is: 100_000, cm: 5000, due: 100_000 });
    expect(computeTax(P, 150_000_000, 0)).toMatchObject({ rate: 35, is: 52_500_000 });
    expect(computeTax({ ...P, regime: 'credit' }, 1_000_000, 0)).toMatchObject({ rate: 40, is: 400_000 });
    expect(computeTax(P, -80_000, 4_000_000)).toEqual({ rate: 20, is: 0, cm: 10_000, due: 10_000 });   // déficit : CM
    expect(computeTax(P, 0, 100_000)).toMatchObject({ cm: 3000, due: 3000 });                           // minimum
    expect(computeTax({ ...P, cm_exempt: true }, -1, 1_000_000)).toMatchObject({ cm: 0, due: 0 });
  });
});

describe.skipIf(!hasTestDb)('Impôt sur les sociétés', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let tax: typeof import('../../repositories/corporate-tax.repository.js').corporateTaxRepository;
  let rateFor: typeof import('../../repositories/corporate-tax.repository.js').rateFor;
  let manual: typeof import('../../repositories/manual-entry.repository.js').manualEntryRepository;
  let actor: { userId: string; storeId: string | null };
  // Exercices réservés à ce test (ni écritures d'autres suites, ni périodes futures) ;
  // remis à zéro avant et après : versements extournés, comptabilisation annulée.
  const Y = 2025;
  const acc: Record<string, string> = {};
  const r2 = (n: number) => Math.round(n * 100) / 100;

  const result = async (year: number, produits: number, charges: number) => {
    const line = (code: string, d: number, c: number) => ({ accountId: acc[code], debit: d, credit: c });
    await manual.createAndPost({ journalCode: 'OD', date: `${year}-06-30`, description: `Activité ${year} ${RUN}`, lines: [
      line('5161', produits, 0), line('7111', 0, produits),
    ] }, actor);
    await manual.createAndPost({ journalCode: 'OD', date: `${year}-06-30`, description: `Charges ${year} ${RUN}`, lines: [
      line('6181', charges, 0), line('5161', 0, charges),
    ] }, actor);
  };
  const reset = async (year: number) => {
    const s = await tax.summary(year);
    for (const p of s.payments.filter(x => x.kind === 'solde')) await tax.cancelPayment(p.id, 'remise à zéro du test', actor);
    if (s.status === 'booked') await tax.unbook(year, 'remise à zéro du test', actor);
    for (const p of s.payments.filter(x => x.kind === 'acompte')) await tax.cancelPayment(p.id, 'remise à zéro du test', actor);
    for (const a of s.adjustments) await tax.removeAdjustment(a.id, actor);
  };

  beforeAll(async () => {
    repos = await importRepositories();
    ({ corporateTaxRepository: tax, rateFor } = await import('../../repositories/corporate-tax.repository.js'));
    manual = (await import('../../repositories/manual-entry.repository.js')).manualEntryRepository;
    const p = testPool();
    const admin = (await p.query(`SELECT id, store_id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`)).rows[0];
    actor = { userId: admin.id, storeId: admin.store_id ?? null };
    for (const r of (await p.query(`SELECT id, code FROM accounts WHERE code IN ('5161', '7111', '6181')`)).rows) acc[r.code] = r.id;
    await reset(Y); await reset(Y - 1);
  }, 60_000);

  afterAll(async () => {
    await reset(Y).catch(() => undefined); await reset(Y - 1).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('exercice N−1 : IS comptabilisé puis soldé', async () => {
    const before = await tax.summary(Y - 1);
    await result(Y - 1, 200_000, 100_000);
    const s = await tax.summary(Y - 1);
    expect(r2(s.accounting_result - before.accounting_result)).toBe(100_000);
    expect(s.is_amount).toBe(r2(s.taxable_result * rateFor(s.params, s.taxable_result) / 100));
    expect(s.imputed).toBe(0);
    const b = await tax.book(Y - 1, actor);
    expect(b).toMatchObject({ tax_due: s.tax_due, imputed: 0, balance_due: s.tax_due });
    await expect(tax.pay(Y - 1, { kind: 'solde', amount: s.tax_due + 1, date: `${Y}-03-15`, treasury: 'bank' }, actor)).rejects.toThrow(/restant dû/);
    await tax.pay(Y - 1, { kind: 'solde', amount: s.tax_due, date: `${Y}-03-15`, treasury: 'bank' }, actor);
    expect((await tax.summary(Y - 1)).balance_due).toBe(0);
  });

  it('exercice N : acomptes sur l\'impôt N−1, résultat fiscal, charge imputant les acomptes', async () => {
    const prev = await tax.summary(Y - 1);
    let s = await tax.summary(Y);
    const expectedBasis = Math.max(r2(prev.taxable_result * rateFor(s.params, prev.taxable_result) / 100), prev.cm_amount);
    expect(s.basis).toMatchObject({ source: 'previous', tax: expectedBasis });
    expect(s.prior_credit).toBe(0);
    const q = r2(expectedBasis / 4);
    expect(s.schedule.map(x => [x.due_date, x.to_pay])).toEqual([
      [`${Y}-03-31`, q], [`${Y}-06-30`, q], [`${Y}-09-30`, q], [`${Y}-12-31`, q],
    ]);
    for (const k of [1, 2, 3, 4]) {
      await tax.pay(Y, { kind: 'acompte', quarter: k, amount: 5000, date: s.schedule[k - 1].due_date, treasury: 'bank' }, actor);
    }
    await expect(tax.pay(Y, { kind: 'acompte', quarter: 2, amount: 5000, date: `${Y}-06-30`, treasury: 'bank' }, actor)).rejects.toThrow(/déjà versé/);

    const before = await tax.summary(Y);
    await result(Y, 1_000_000, 600_000);
    await tax.addAdjustment(Y, { kind: 'reintegration', label: 'Amendes et pénalités', amount: 50_000 }, actor);
    await tax.addAdjustment(Y, { kind: 'deduction', label: 'Dividendes reçus', amount: 10_000 }, actor);
    s = await tax.summary(Y);
    expect(r2(s.taxable_result - before.taxable_result)).toBe(440_000);
    expect(r2(s.cm_base - before.cm_base)).toBe(1_000_000);
    expect(s.is_amount).toBe(r2(s.taxable_result * rateFor(s.params, s.taxable_result) / 100));
    expect(s.tax_due).toBe(Math.max(s.is_amount, s.cm_amount));
    expect(s).toMatchObject({ acomptes_paid: 20_000, imputed: Math.min(20_000, s.tax_due), balance_due: r2(s.tax_due - Math.min(20_000, s.tax_due)) });

    const b = await tax.book(Y, actor);
    const lines = (await testPool().query(
      `SELECT a.code, jel.debit::float8 AS d, jel.credit::float8 AS c FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id JOIN accounts a ON a.id = jel.account_id
        WHERE je.entry_number = $1 ORDER BY jel.line_order`, [b.entry_number])).rows;
    expect(lines).toEqual([
      { code: '6701', d: s.tax_due, c: 0 }, { code: '3453', d: 0, c: s.imputed }, { code: '4453', d: 0, c: r2(s.tax_due - s.imputed) },
    ]);
    expect((await tax.summary(Y)).net_result).toBe(r2(s.accounting_result - s.tax_due));
  });

  it('calcul figé après comptabilisation ; annulation puis nouvelle comptabilisation', async () => {
    await expect(tax.addAdjustment(Y, { kind: 'reintegration', label: 'Tardif', amount: 1 }, actor)).rejects.toThrow(/déjà comptabilisé/);
    const s = await tax.summary(Y);
    const acompte = s.payments.find(p => p.kind === 'acompte')!;
    await expect(tax.cancelPayment(acompte.id, 'test', actor)).rejects.toThrow(/annulez d'abord la comptabilisation/);
    const entry = (await testPool().query(`SELECT charge_entry_id FROM corporate_tax_years WHERE year = $1`, [Y])).rows[0].charge_entry_id;
    await expect(manual.reverse(entry, { reason: 'test' }, actor)).rejects.toThrow(/impôt sur les sociétés/);

    await tax.unbook(Y, `correction ${RUN}`, actor);
    expect((await tax.summary(Y)).status).toBe('draft');
    expect((await tax.book(Y, actor)).tax_due).toBe(s.tax_due);
  });
});
