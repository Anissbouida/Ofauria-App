/**
 * Balance âgée comptable — intégration base migrée.
 *
 * Un fournisseur neuf, à J :
 *   - facture A (300, échue depuis 70 j) réglée 100 → reste 200 en 61-90 j ;
 *   - facture B (50, échéance dans 10 j) → 50 non échu ;
 *   - OD au débit du tiers (20, il y a 5 j) → −20 en 1-30 j ;
 *   - facture C (80) soldée et lettrée → absente.
 * Total 230 ; le total général égale le solde comptable des comptes fournisseurs.
 * À une date passée (avant le règlement), la facture A doit encore 300.
 */
import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Balance âgée comptable', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let aged: typeof import('../../repositories/aged-balance.repository.js').agedBalanceRepository;
  let lettrage: typeof import('../../repositories/lettrage.repository.js').lettrageRepository;
  let admin: string;
  let aux: string;
  let supplier: string;
  const acc: Record<string, string> = {};
  const d = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const day = d(0);

  /** Écriture comptabilisée sur le tiers (backfill : la pièce source la relie à la facture). */
  const entry = async (date: string, sourceId: string | null, tiers: 'debit' | 'credit', amount: number) => {
    const p = testPool();
    const e = (await p.query(
      `INSERT INTO journal_entries (entry_number, journal_id, entry_date, fiscal_period_id, description, source_kind, source_id, created_by)
       SELECT $1::text, j.id, $2::date, fn_ensure_fiscal_period($2::date), $1::text, $3, $4, $5 FROM journals j WHERE j.code = 'AC' RETURNING id`,
      [`AGE-${crypto.randomUUID().slice(0, 8)}`, date, sourceId ? 'backfill' : 'manual', sourceId, admin])).rows[0].id;
    await p.query(
      `INSERT INTO journal_entry_lines (journal_entry_id, line_order, account_id, auxiliary_id, debit, credit)
       VALUES ($1, 1, $2, $3, $4, $5), ($1, 2, $6, NULL, $5, $4)`,
      [e, acc['4411'], aux, tiers === 'debit' ? amount : 0, tiers === 'credit' ? amount : 0, tiers === 'debit' ? acc['5161'] : acc['6181']]);
    await p.query(`UPDATE journal_entries SET status = 'posted', posted_at = now(), posted_by = $2 WHERE id = $1`, [e, admin]);
    return (await p.query(`SELECT id FROM journal_entry_lines WHERE journal_entry_id = $1 AND line_order = 1`, [e])).rows[0].id as string;
  };
  const invoice = async (n: string, date: string, due: string, total: number) => (await testPool().query(
    `INSERT INTO invoices (invoice_number, invoice_type, supplier_id, invoice_date, due_date, amount, total_amount, status)
     VALUES ($1, 'received', $2, $3, $4, $5, $5, 'pending') RETURNING id`, [`${n}-${RUN}`, supplier, date, due, total])).rows[0].id as string;
  const payment = async (inv: string, date: string, amount: number) => (await testPool().query(
    `INSERT INTO payments (type, invoice_id, supplier_id, amount, payment_date, payment_method, payment_mode, reference)
     VALUES ('invoice', $1, $2, $3, $4, 'virement', 'virement', $5) RETURNING id`,
    [inv, supplier, amount, date, `VIR-${crypto.randomUUID().slice(0, 8)}`])).rows[0].id as string;

  beforeAll(async () => {
    repos = await importRepositories();
    aged = (await import('../../repositories/aged-balance.repository.js')).agedBalanceRepository;
    lettrage = (await import('../../repositories/lettrage.repository.js')).lettrageRepository;
    const p = testPool();
    admin = (await p.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`)).rows[0].id;
    for (const r of (await p.query(`SELECT id, code FROM accounts WHERE code IN ('6181', '5161', '4411')`)).rows) acc[r.code] = r.id;
    supplier = (await p.query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`Fournisseur âgé ${RUN}`])).rows[0].id;
    // Le sous-compte du fournisseur est créé à la volée (trigger) ; sinon on le pose.
    aux = (await p.query(`SELECT id FROM account_auxiliaries WHERE supplier_id = $1`, [supplier])).rows[0]?.id
      ?? (await p.query(
        `INSERT INTO account_auxiliaries (account_id, supplier_id, code, label) VALUES ($1, $2, $3, $4) RETURNING id`,
        [acc['4411'], supplier, `F-AGE-${RUN}`.slice(0, 30), `Fournisseur âgé ${RUN}`])).rows[0].id;

    const a = await invoice('FA-A', d(-100), d(-70), 300);
    await entry(d(-100), a, 'credit', 300);
    await entry(d(-50), await payment(a, d(-50), 100), 'debit', 100);
    const b = await invoice('FA-B', day, d(10), 50);
    await entry(day, b, 'credit', 50);
    await entry(d(-5), null, 'debit', 20);
    const c = await invoice('FA-C', d(-20), d(-20), 80);
    const cl = await entry(d(-20), c, 'credit', 80);
    const cp = await entry(d(-10), await payment(c, d(-10), 80), 'debit', 80);
    await lettrage.letter([cl, cp], { userId: admin });
  }, 60_000);

  afterAll(async () => {
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('classe le reste dû par échéance et concorde avec le grand livre', async () => {
    const r = await aged.compute({ side: 'suppliers', asOf: day });
    expect(r.totals.total).toBe(r.ledger_balance);
    const t = r.tiers.find(x => x.auxiliary_id === aux)!;
    expect(t.total).toBe(230);
    expect(t.buckets).toEqual({ current: 50, d30: -20, d60: 0, d90: 200, over90: 0 });
    expect(t.overdue).toBe(180);
    expect(t.max_days_late).toBe(70);
    const a = t.items.find(i => i.reference === `FA-A-${RUN}`)!;
    expect(a).toMatchObject({ kind: 'invoice', amount: 200, days_late: 70, bucket: 'd90' });
    expect(t.items.some(i => i.reference === `FA-C-${RUN}`)).toBe(false);   // soldée et lettrée
    expect(t.items.find(i => i.amount === -20)?.kind).toBe('other');
  });

  it('à une date passée, compte ce qui était encore ouvert', async () => {
    const r = await aged.compute({ side: 'suppliers', asOf: d(-60) });
    expect(r.totals.total).toBe(r.ledger_balance);
    const t = r.tiers.find(x => x.auxiliary_id === aux)!;
    expect(t.items.map(i => [i.reference, i.amount, i.bucket])).toEqual([[`FA-A-${RUN}`, 300, 'd30']]);
  });

  it('la facture lettrée après la date reste ouverte à cette date', async () => {
    const r = await aged.compute({ side: 'suppliers', asOf: d(-15) });
    const t = r.tiers.find(x => x.auxiliary_id === aux)!;
    expect(t.items.find(i => i.reference === `FA-C-${RUN}`)?.amount).toBe(80);
    expect(t.total).toBe(280);
  });
});
