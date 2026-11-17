/**
 * G4-01 — paiements fournisseurs en lot.
 * Test du plan : campagne de trois factures → trois règlements, écritures équilibrées,
 * factures soldées et lettrées. En plus :
 *  - refus à la préparation : facture non validée, montant au-delà du reste, facture
 *    déjà dans une campagne ouverte, compte de caisse ;
 *  - refus à la soumission : RIB du fournisseur invalide ;
 *  - circuit : brouillon → approuvée → fichier édité → exécutée ; exécuter avant le
 *    fichier est refusé ; le fichier porte une ligne par fournisseur ;
 *  - rejet bancaire d'une ligne : règlement annulé, facture de nouveau à payer.
 */
import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Paiements fournisseurs en lot (G4-01)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let runs: typeof import('../../repositories/payment-run.repository.js')['paymentRunRepository'];
  let ribKey: (first22: string) => string;
  let actor: { userId: string; storeId: string | null };
  let bank: string, cash: string, supplier: string, badSupplier: string, voidReason: string;
  const acc: Record<string, string> = {};
  const invoices: string[] = [];
  const day = new Date().toISOString().slice(0, 10);
  const k = Math.round(Math.random() * 90000) / 100;   // montants propres au passage (détection de doublons)
  const p = () => testPool();

  /** Facture fournisseur validée, avec son écriture d'achat (crédit 4411 du tiers). */
  const invoice = async (supplierId: string, n: string, total: number, validated = true) => {
    const id = (await p().query(
      `INSERT INTO invoices (invoice_number, invoice_type, supplier_id, invoice_date, due_date, amount, total_amount, status,
                             supplier_invoice_number, declared_ttc, validation_status)
       VALUES ($1, 'received', $2, $3, $3, $4, $4, 'pending', $1, $4, $5) RETURNING id`,
      [`${n}-${RUN}`, supplierId, day, total, validated ? 'validated' : 'draft'])).rows[0].id as string;
    invoices.push(id);
    const aux = (await p().query(`SELECT id FROM account_auxiliaries WHERE supplier_id = $1`, [supplierId])).rows[0].id;
    const e = (await p().query(
      `INSERT INTO journal_entries (entry_number, journal_id, entry_date, fiscal_period_id, description, source_kind, source_id, created_by)
       SELECT $1::text, j.id, $2::date, fn_ensure_fiscal_period($2::date), $1::text, 'backfill', $3, $4 FROM journals j WHERE j.code = 'OD' RETURNING id`,
      [`BF-${crypto.randomUUID().slice(0, 8)}`, day, id, actor.userId])).rows[0].id;
    await p().query(
      `INSERT INTO journal_entry_lines (journal_entry_id, line_order, account_id, auxiliary_id, debit, credit)
       VALUES ($1, 1, $2, $3, 0, $4), ($1, 2, $5, NULL, $4, 0)`, [e, acc['4411'], aux, total, acc['6181']]);
    await p().query(`UPDATE journal_entries SET status = 'posted', posted_at = now(), posted_by = $2 WHERE id = $1`, [e, actor.userId]);
    return id;
  };

  beforeAll(async () => {
    repos = await importRepositories();
    ({ paymentRunRepository: runs } = await import('../../repositories/payment-run.repository.js'));
    ({ ribKey } = await import('../../services/salary-transfer.js'));
    const admin = (await p().query(`SELECT id, store_id FROM users WHERE role = 'admin' AND NOT is_system ORDER BY created_at LIMIT 1`)).rows[0];
    actor = { userId: admin.id, storeId: admin.store_id ?? null };
    for (const r of (await p().query(`SELECT id, code FROM accounts WHERE code IN ('6181', '4411')`)).rows) acc[r.code] = r.id;
    bank = (await p().query(`SELECT id FROM treasury_accounts WHERE kind = 'bank' AND is_active ORDER BY is_default DESC LIMIT 1`)).rows[0].id;
    cash = (await p().query(`SELECT id FROM treasury_accounts WHERE kind = 'cash' AND is_active LIMIT 1`)).rows[0].id;
    voidReason = (await p().query(
      `SELECT id FROM ref_entries WHERE table_id = 'purchase_reason_codes' AND is_active AND metadata -> 'scope' ? 'void_payment'
         AND NOT COALESCE((metadata->>'requires_note')::boolean, false) LIMIT 1`)).rows[0]?.id
      ?? (await p().query(`SELECT id FROM ref_entries WHERE table_id = 'purchase_reason_codes' AND is_active AND metadata -> 'scope' ? 'void_payment' LIMIT 1`)).rows[0].id;
    const first22 = `0117800000${String(Date.now()).slice(-12)}`;
    supplier = (await p().query(
      `INSERT INTO suppliers (name, rib, bank_name, email) VALUES ($1, $2, 'Attijariwafa', $3) RETURNING id`,
      [`Fournisseur lot ${RUN}`, `${first22}${ribKey(first22)}`, `fournisseur-${RUN}@test.local`])).rows[0].id;
    badSupplier = (await p().query(`INSERT INTO suppliers (name, rib) VALUES ($1, '123') RETURNING id`, [`Sans RIB ${RUN}`])).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM payment_run_lines WHERE invoice_id = ANY($1)`, [invoices]).catch(() => undefined);
    await p().query(`DELETE FROM payment_runs WHERE run_number LIKE $1 AND NOT EXISTS (SELECT 1 FROM payment_run_lines l WHERE l.run_id = payment_runs.id)`, [`CP-${day.replace(/-/g, '')}-%`]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  let runId: string, inv1: string, inv2: string, inv3: string;

  it('refus à la préparation : non validée, au-delà du reste, compte de caisse', async () => {
    inv1 = await invoice(supplier, 'FL1', 100 + k);
    inv2 = await invoice(supplier, 'FL2', 200 + k);
    inv3 = await invoice(supplier, 'FL3', 300 + k);
    const draft = await invoice(supplier, 'FLD', 50 + k, false);
    const base = { paymentDate: day, treasuryAccountId: bank, userId: actor.userId, storeId: actor.storeId };
    await expect(runs.create({ ...base, lines: [{ invoiceId: draft, amount: 50 + k }] })).rejects.toThrow(/n'est pas payable/);
    await expect(runs.create({ ...base, lines: [{ invoiceId: inv1, amount: 1000 + k }] })).rejects.toThrow(/dépasse le reste à payer/);
    await expect(runs.create({ ...base, treasuryAccountId: cash, lines: [{ invoiceId: inv1, amount: 100 + k }] })).rejects.toThrow(/compte bancaire/);
    // Les factures validées sont proposées, pas la facture en brouillon.
    const cands = (await runs.candidates({ dueBefore: day })).filter(c => c.supplier_id === supplier);
    expect(cands.map(c => c.invoice_id).sort()).toEqual([inv1, inv2, inv3].sort());
    expect(cands.every(c => c.ribValid)).toBe(true);
  });

  it('campagne de trois factures : brouillon, une facture ne peut être que dans une campagne ouverte', async () => {
    runId = await runs.create({
      paymentDate: day, treasuryAccountId: bank, userId: actor.userId, storeId: actor.storeId,
      lines: [{ invoiceId: inv1, amount: 100 + k }, { invoiceId: inv2, amount: 200 + k }, { invoiceId: inv3, amount: 300 + k }],
    });
    const run = (await runs.get(runId))!;
    expect(run.status).toBe('draft');
    expect(run.total_amount).toBeCloseTo(600 + 3 * k, 2);
    expect(run.run_number).toMatch(new RegExp(`^CP-${day.replace(/-/g, '')}-\\d{2}$`));
    await expect(runs.create({ paymentDate: day, treasuryAccountId: bank, userId: actor.userId, lines: [{ invoiceId: inv2, amount: 10 }] }))
      .rejects.toThrow(new RegExp(`déjà dans la campagne ${run.run_number}`));
    expect((await runs.candidates({ dueBefore: day })).find(c => c.invoice_id === inv2)!.open_run).toBe(run.run_number);
  });

  it('soumission refusée si un RIB est invalide', async () => {
    const other = await invoice(badSupplier, 'FLB', 70 + k);
    const badRun = await runs.create({ paymentDate: day, treasuryAccountId: bank, userId: actor.userId, lines: [{ invoiceId: other, amount: 70 + k }] });
    await expect(runs.submit(badRun, actor.userId)).rejects.toThrow(/RIB absent ou invalide pour : Sans RIB/);
    await runs.cancel(badRun, actor.userId);
    expect((await runs.get(badRun))!.status).toBe('cancelled');
  });

  it('approuvée, fichier édité (une ligne par fournisseur), puis exécutée : trois règlements, factures soldées et lettrées', async () => {
    expect(await runs.submit(runId, actor.userId)).toEqual({ status: 'approved' });   // administrateur : pas de circuit
    await expect(runs.execute(runId, actor)).rejects.toThrow(/Éditez le fichier de virement/);

    const file = await runs.transferFile(runId);
    const rows = file.csv.trim().split('\r\n');
    expect(rows).toHaveLength(2);                                          // en-tête + une ligne pour l'unique fournisseur
    expect(rows[1]).toContain((600 + 3 * k).toFixed(2));
    expect((await runs.get(runId))!.status).toBe('file_generated');

    const out = await runs.execute(runId, actor);
    expect(out).toEqual({ executed: 3, advices: 1 });
    const run = (await runs.get(runId))!;
    expect(run.status).toBe('executed');
    expect(run.lines.every(l => l.status === 'paid' && l.payment_id)).toBe(true);

    const inv = (await p().query(`SELECT id, status, paid_amount::float8 AS paid, total_amount::float8 AS total FROM invoices WHERE id = ANY($1)`, [[inv1, inv2, inv3]])).rows;
    expect(inv.every(i => i.status === 'paid' && Math.abs(i.paid - i.total) < 0.005)).toBe(true);

    // Écritures des règlements : équilibrées, sur le compte bancaire.
    const entries = (await p().query(
      `SELECT je.id, SUM(jel.debit)::float8 AS d, SUM(jel.credit)::float8 AS c
         FROM journal_entries je JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
        WHERE je.source_id IN (SELECT payment_id FROM payment_run_lines WHERE run_id = $1) GROUP BY je.id`, [runId])).rows;
    expect(entries).toHaveLength(3);
    expect(entries.every(e => Math.abs(e.d - e.c) < 0.005)).toBe(true);

    // Lettrage : chaque facture et son règlement partagent un code de lettrage sur 4411.
    for (const id of [inv1, inv2, inv3]) {
      const lettrage = (await p().query(
        `SELECT jel.lettrage_id FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id
          WHERE jel.account_id = $2 AND (je.source_id = $1 OR je.source_id IN (SELECT id FROM payments WHERE invoice_id = $1))`,
        [id, acc['4411']])).rows.map(r => r.lettrage_id);
      expect(lettrage).toHaveLength(2);
      expect(lettrage[0]).not.toBeNull();
      expect(lettrage[1]).toBe(lettrage[0]);
    }
    // Avis de paiement en file pour le fournisseur.
    expect((await p().query(`SELECT COUNT(*)::int AS n FROM email_outbox WHERE reference_id = $1 AND type = 'payment_advice'`, [runId])).rows[0].n).toBe(1);
  }, 120_000);

  it('rejet bancaire d\'une ligne : règlement annulé, facture de nouveau à payer', async () => {
    const run = (await runs.get(runId))!;
    const line = run.lines.find(l => l.invoice_id === inv2)!;
    await runs.rejectLine(line.id, { reasonCodeId: voidReason, note: 'RIB clôturé', userId: actor.userId });
    expect((await runs.get(runId))!.lines.find(l => l.id === line.id)!.status).toBe('rejected');
    const inv = (await p().query(`SELECT status, paid_amount::float8 AS paid FROM invoices WHERE id = $1`, [inv2])).rows[0];
    expect(inv.paid).toBeCloseTo(0, 2);
    expect(inv.status).not.toBe('paid');
    expect((await p().query(`SELECT voided_at FROM payments WHERE id = $1`, [line.payment_id])).rows[0].voided_at).not.toBeNull();
    await expect(runs.rejectLine(line.id, { reasonCodeId: voidReason, note: 'deux fois', userId: actor.userId })).rejects.toThrow(/Seule une ligne réglée/);
    // Elle redevient candidate à une prochaine campagne.
    expect((await runs.candidates({ dueBefore: day })).some(c => c.invoice_id === inv2 && !c.open_run)).toBe(true);
  }, 60_000);
});
