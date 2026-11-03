/**
 * Multidevise, lot 3 (mig 431) — intégration base migrée.
 *
 * Devise de test XTS (code ISO réservé aux essais), exercices 2022 et 2023
 * réservés à ce test : les réévaluations comptabilisées sont annulées avant et
 * après. Les factures des passages précédents restent ouvertes : on vérifie
 * nos lignes et les formules, pas des totaux absolus.
 *
 *   Facture fournisseur 1 000 XTS au taux 10 (10 000 DH), acompte 400 XTS au
 *   taux 10,5 le 10/12/2022 → perte réalisée 200 (6331).
 *   Facture client 500 XTS au taux 10 (5 000 DH).
 *   Clôture 2022 au taux 11 : dette 600 XTS → +600 (3702, perte latente,
 *   provisionnée) ; créance 500 XTS → +500 (4701, gain latent).
 *   Encaissement client 200 XTS au taux 11 le 15/01/2023 → gain réalisé 200 (7331).
 *   Clôture 2023 au taux 9 : dette −600 (4702), créance 300 XTS −300 (3701),
 *   reprise de la provision 2022.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';
import { revalue, tiersLine } from '../../services/fx-revaluation.rules.js';

describe('Réévaluation de clôture — règles', () => {
  it('compte d\'écart selon le sens et le tiers', () => {
    expect(revalue('payable', 600, 6000, 11)).toMatchObject({ closingAmount: 6600, difference: 600, account: '3702', latentLoss: true });
    expect(revalue('payable', 600, 6000, 9)).toMatchObject({ difference: -600, account: '4702', latentLoss: false });
    expect(revalue('receivable', 500, 5000, 11)).toMatchObject({ difference: 500, account: '4701', latentLoss: false });
    expect(revalue('receivable', 300, 3000, 9)).toMatchObject({ difference: -300, account: '3701', latentLoss: true });
    expect(revalue('receivable', 100, 1000, 10).account).toBeNull();
    expect(tiersLine('payable', 600)).toEqual({ code: '4411', debit: 0, credit: 600 });
    expect(tiersLine('receivable', -300)).toEqual({ code: '3421', debit: 0, credit: 300 });
  });
});

describe.skipIf(!hasTestDb)('Multidevise — ventes et réévaluation de clôture', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fx: typeof import('../../repositories/fx-revaluation.repository.js').fxRevaluationRepository;
  let invoices: typeof import('../../repositories/accounting.repository.js').invoiceRepository;
  let payments: typeof import('../../repositories/accounting.repository.js').paymentRepository;
  let manual: typeof import('../../repositories/manual-entry.repository.js').manualEntryRepository;
  let actor: { userId: string };
  const ids: { supplier?: string; customer?: string; sInv?: string; cInv?: string } = {};
  const reset = async () => {
    for (const y of [2023, 2022]) {
      if ((await fx.summary(y)).status === 'booked') await fx.cancel(y, 'remise à zéro du test', actor);
    }
  };
  /** Taux de clôture : XTS imposé, les autres devises ouvertes à leur taux de la table (ou 10). */
  const ratesFor = async (year: number, xts: number) => {
    const s = await fx.summary(year, { XTS: xts });
    return Object.fromEntries(Object.entries(s.rates).map(([k, v]) => [k, k === 'XTS' ? xts : v.rate ?? 10]));
  };
  const entryLines = (entryNumber: string) => testPool().query(
    `SELECT a.code, jel.auxiliary_id, jel.debit::float8 AS d, jel.credit::float8 AS c, jel.lettrage_id
       FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id JOIN accounts a ON a.id = jel.account_id
      WHERE je.entry_number = $1 ORDER BY jel.line_order`, [entryNumber]).then(r => r.rows);
  const aux = async (col: 'supplier_id' | 'customer_id', id: string) =>
    (await testPool().query(`SELECT id FROM account_auxiliaries WHERE ${col} = $1`, [id])).rows[0]?.id as string;

  beforeAll(async () => {
    repos = await importRepositories();
    fx = (await import('../../repositories/fx-revaluation.repository.js')).fxRevaluationRepository;
    ({ invoiceRepository: invoices, paymentRepository: payments } = await import('../../repositories/accounting.repository.js'));
    manual = (await import('../../repositories/manual-entry.repository.js')).manualEntryRepository;
    const p = testPool();
    actor = { userId: (await p.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`)).rows[0].id };
    await p.query(`INSERT INTO currencies (code, label, decimals) VALUES ('XTS', 'Devise de test', 2) ON CONFLICT (code) DO NOTHING`);
    ids.supplier = (await p.query(`INSERT INTO suppliers (name, currency_code) VALUES ($1, 'XTS') RETURNING id`, [`Fournisseur devise ${RUN}`])).rows[0].id;
    ids.customer = (await p.query(`INSERT INTO customers (company_name, first_name, last_name) VALUES ($1, 'Client', 'Export') RETURNING id`, [`Client export ${RUN}`])).rows[0].id;
    await reset();
  }, 60_000);

  afterAll(async () => {
    await reset().catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('facture client en devise et règlement fournisseur en devise', async () => {
    const s = await invoices.create({ invoiceType: 'received', supplierId: ids.supplier, invoiceDate: '2022-11-15', amount: 10_000, taxAmount: 0,
      totalAmount: 10_000, currencyCode: 'XTS', exchangeRate: 10, createdBy: actor.userId });
    const c = await invoices.create({ invoiceType: 'emitted', customerId: ids.customer, invoiceDate: '2022-11-20', amount: 5000, taxAmount: 0,
      totalAmount: 5000, currencyCode: 'XTS', exchangeRate: 10, createdBy: actor.userId });
    ids.sInv = s.id; ids.cInv = c.id;
    // Facture reçue née en brouillon (P2P L1, mig 438) : validée sur la pièce du fournisseur avant règlement.
    await testPool().query(
      `UPDATE invoices SET supplier_invoice_number = $2, declared_ttc = total_amount, validation_status = 'validated' WHERE id = $1`,
      [s.id, `FXT-${RUN}`]);
    expect(Number(c.foreign_total_amount)).toBe(500);
    const pay = await payments.create({ type: 'invoice', invoiceId: s.id, supplierId: ids.supplier, amount: 0, paymentMethod: 'bank', reference: `VIR-F-${RUN}`,
      paymentDate: '2022-12-10', foreignAmount: 400, exchangeRate: 10.5, createdBy: actor.userId });
    expect(Number(pay.amount)).toBe(4200);
    expect(Number(pay.settled_amount)).toBe(4000);
    const lines = (await testPool().query(
      `SELECT a.code, jel.debit::float8 AS d, jel.credit::float8 AS c FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id JOIN accounts a ON a.id = jel.account_id
        WHERE je.source_id = $1 AND je.source_kind = 'payment' ORDER BY jel.line_order`, [pay.id])).rows;
    expect(lines).toEqual([{ code: '4411', d: 4000, c: 0 }, { code: '6331', d: 200, c: 0 }, { code: '5141', d: 0, c: 4200 }]);
  });

  it('réévaluation 2022 : écarts de conversion, provision, contre-passation lettrée', async () => {
    const s = await fx.summary(2022, { XTS: 11 });
    expect(s.status).toBe('draft');
    const mine = (id: string) => s.lines.find(l => l.invoice_id === id)!;
    expect(mine(ids.sInv!)).toMatchObject({ side: 'payable', foreign_remaining: 600, book_amount: 6000, closing_amount: 6600, difference: 600, account_code: '3702' });
    expect(mine(ids.cInv!)).toMatchObject({ side: 'receivable', foreign_remaining: 500, book_amount: 5000, closing_amount: 5500, difference: 500, account_code: '4701' });
    expect(s.provision).toBe(s.loss_total);

    const b = await fx.book(2022, await ratesFor(2022, 11), actor);
    expect(b.reopen_entry_number).toBeTruthy();
    const sAux = await aux('supplier_id', ids.supplier!), cAux = await aux('customer_id', ids.customer!);
    const reval = await entryLines(b.reval_entry_number);
    expect(reval.find(l => l.auxiliary_id === sAux)).toMatchObject({ code: '4411', d: 0, c: 600 });
    expect(reval.find(l => l.auxiliary_id === cAux)).toMatchObject({ code: '3421', d: 500, c: 0 });
    const tot = (code: string, side: 'd' | 'c') => reval.filter(l => l.code === code).reduce((x, l) => x + l[side], 0);
    expect(tot('3702', 'd') + tot('3701', 'd')).toBeCloseTo(b.loss_total, 2);
    expect(tot('4701', 'c') + tot('4702', 'c')).toBeCloseTo(b.gain_total, 2);
    expect(tot('6393', 'd')).toBeCloseTo(b.provision, 2);
    expect(reval.reduce((x, l) => x + l.d - l.c, 0)).toBeCloseTo(0, 2);

    const reopen = await entryLines(b.reopen_entry_number!);
    const date = (await testPool().query(`SELECT entry_date::text AS d FROM journal_entries WHERE entry_number = $1`, [b.reopen_entry_number])).rows[0].d;
    expect(date).toBe('2023-01-01');
    expect(reopen.find(l => l.auxiliary_id === sAux)).toMatchObject({ code: '4411', d: 600, c: 0 });
    expect(reopen.some(l => ['6393', '4506'].includes(l.code))).toBe(false);
    const sGroup = reval.find(l => l.auxiliary_id === sAux)!.lettrage_id;
    expect(sGroup).toBeTruthy();
    expect(reopen.find(l => l.auxiliary_id === sAux)!.lettrage_id).toBe(sGroup);

    await expect(fx.book(2022, { XTS: 11 }, actor)).rejects.toThrow(/déjà comptabilisée/);
    const entryId = (await testPool().query(`SELECT id FROM journal_entries WHERE entry_number = $1`, [b.reval_entry_number])).rows[0].id;
    await expect(manual.reverse(entryId, { reason: 'test' }, { ...actor, storeId: null })).rejects.toThrow(/réévaluation des devises/);
  });

  it('encaissement client en devise : gain de change réalisé', async () => {
    const pay = await payments.create({ type: 'income', invoiceId: ids.cInv, amount: 0, paymentMethod: 'bank', reference: `VIR-C-${RUN}`,
      paymentDate: '2023-01-15', foreignAmount: 200, exchangeRate: 11, createdBy: actor.userId });
    expect(Number(pay.amount)).toBe(2200);
    expect(Number(pay.settled_amount)).toBe(2000);
    const lines = (await testPool().query(
      `SELECT a.code, jel.debit::float8 AS d, jel.credit::float8 AS c FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id JOIN accounts a ON a.id = jel.account_id
        WHERE je.source_id = $1 AND je.source_kind = 'payment' ORDER BY jel.line_order`, [pay.id])).rows;
    expect(lines).toEqual([{ code: '5141', d: 2200, c: 0 }, { code: '3421', d: 0, c: 2000 }, { code: '7331', d: 0, c: 200 }]);
    const inv = (await testPool().query(`SELECT paid_amount::float8 AS p, foreign_paid_amount::float8 AS f, status FROM invoices WHERE id = $1`, [ids.cInv])).rows[0];
    expect(inv).toEqual({ p: 2000, f: 200, status: 'partial' });
  });

  it('réévaluation 2023 : sens inverse, reprise de la provision 2022 ; annulations dans l\'ordre', async () => {
    const prev = await fx.summary(2022);
    const b = await fx.book(2023, await ratesFor(2023, 9), actor);
    const s = await fx.summary(2023);
    expect(s.status).toBe('booked');
    const mine = (id: string) => s.lines.find(l => l.invoice_id === id)!;
    expect(mine(ids.sInv!)).toMatchObject({ foreign_remaining: 600, difference: -600, account_code: '4702' });
    expect(mine(ids.cInv!)).toMatchObject({ foreign_remaining: 300, book_amount: 3000, difference: -300, account_code: '3701' });
    expect(b.provision_reversal).toBe(prev.provision);
    const reval = await entryLines(b.reval_entry_number);
    expect(reval.filter(l => l.code === '7393').reduce((x, l) => x + l.c, 0)).toBeCloseTo(prev.provision, 2);

    await expect(fx.cancel(2022, 'test', actor)).rejects.toThrow(/annulez-la d'abord/);
    await fx.cancel(2023, `correction ${RUN}`, actor);
    await fx.cancel(2022, `correction ${RUN}`, actor);
    expect((await fx.summary(2022)).status).toBe('draft');
    // Écritures extournées, lignes de tiers toutes lettrées (rien ne reste ouvert).
    const open = (await testPool().query(
      `SELECT count(*)::int AS n FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id
        WHERE jel.auxiliary_id IS NOT NULL AND jel.lettrage_id IS NULL
          AND (je.id IN ($1, $2) OR je.reversal_of_entry_id IN (SELECT id FROM journal_entries WHERE entry_number IN ($3, $4)))`,
      [prev.reval_entry_number ? (await testPool().query(`SELECT id FROM journal_entries WHERE entry_number = $1`, [prev.reval_entry_number])).rows[0].id : null,
       (await testPool().query(`SELECT id FROM journal_entries WHERE entry_number = $1`, [b.reval_entry_number])).rows[0].id,
       prev.reval_entry_number, b.reval_entry_number])).rows[0].n;
    expect(open).toBe(0);
  });
});
