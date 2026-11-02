/**
 * Comptabilité analytique (mig 428) — intégration base migrée.
 *
 *   1. Clé de répartition 60/40 appliquée à une charge ; produit sur une section.
 *   2. La base refuse une ventilation incomplète ou sur un compte de bilan.
 *   3. Extourne : la ventilation suit, la section revient à zéro.
 *   4. Facture affectée à un centre : ses lignes de charge sont ventilées,
 *      une ventilation manuelle n'est pas écrasée.
 *   5. Balance analytique : sections + non ventilé = CPC.
 */
import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Comptabilité analytique', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let an: typeof import('../../repositories/analytic.repository.js');
  let manual: typeof import('../../repositories/manual-entry.repository.js').manualEntryRepository;
  let actor: { userId: string; storeId: string | null };
  let axis: string;
  const sec: Record<string, string> = {};
  const acc: Record<string, string> = {};
  const day = new Date().toISOString().slice(0, 10);
  const tag = crypto.randomUUID().slice(0, 6).toUpperCase();

  /** Écriture CA validée ; renvoie la ligne de gestion (classe 6 ou 7). */
  const entry = async (account: string, side: 'debit' | 'credit', amount: number) => {
    const g = { accountId: acc[account], debit: side === 'debit' ? amount : 0, credit: side === 'credit' ? amount : 0 };
    const t = { accountId: acc['5161'], debit: side === 'credit' ? amount : 0, credit: side === 'debit' ? amount : 0 };
    const { id } = await manual.createAndPost({ journalCode: 'CA', date: day, description: `Analytique ${tag}`, lines: [g, t] }, actor);
    const line = (await testPool().query(`SELECT id FROM journal_entry_lines WHERE journal_entry_id = $1 AND account_id = $2`, [id, acc[account]])).rows[0].id;
    return { entryId: id as string, line: line as string };
  };
  const ventil = async (line: string) => (await testPool().query(
    `SELECT c.code, x.amount::float8 AS amount, x.source FROM journal_line_analytics x JOIN cost_centers c ON c.id = x.cost_center_id
      WHERE x.journal_entry_line_id = $1 ORDER BY c.code`, [line])).rows;
  const sectionOf = (b: Awaited<ReturnType<typeof an.analyticRepository.balance>>, code: string) => b.sections.find(s => s.code === code)!;

  beforeAll(async () => {
    repos = await importRepositories();
    an = await import('../../repositories/analytic.repository.js');
    manual = (await import('../../repositories/manual-entry.repository.js')).manualEntryRepository;
    const p = testPool();
    const admin = (await p.query(`SELECT id, store_id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`)).rows[0];
    actor = { userId: admin.id, storeId: admin.store_id ?? null };
    for (const r of (await p.query(`SELECT id, code FROM accounts WHERE code IN ('6181', '7111', '5161', '4411')`)).rows) acc[r.code] = r.id;
    axis = (await p.query(`SELECT id FROM analytic_axes WHERE code = 'ACT'`)).rows[0].id;
    for (const k of ['BOU', 'PAT']) {
      sec[k] = (await p.query(`INSERT INTO cost_centers (code, name, axis_id) VALUES ($1, $2, $3) RETURNING id`,
        [`${k}${tag}`, `${k} ${RUN}`, axis])).rows[0].id;
    }
  });

  afterAll(async () => {
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('répartit au centime près', () => {
    const parts = an.splitByPercent(10001, [{ id: 'a', percent: 33.3333 }, { id: 'b', percent: 33.3333 }, { id: 'c', percent: 33.3334 }]);
    expect(parts.reduce((s, x) => s + x.cents, 0)).toBe(10001);
  });

  it('clé 60/40 sur une charge, produit sur une section, balance cohérente avec le CPC', async () => {
    const key = await an.analyticRepository.createKey({ axisId: axis, name: `Loyer ${tag}`, lines: [
      { costCenterId: sec.BOU, percent: 60 }, { costCenterId: sec.PAT, percent: 40 },
    ] }, actor);
    await expect(an.analyticRepository.createKey({ axisId: axis, name: `Faux ${tag}`, lines: [
      { costCenterId: sec.BOU, percent: 60 }, { costCenterId: sec.PAT, percent: 30 },
    ] }, actor)).rejects.toThrow(/90 %/);

    const charge = await entry('6181', 'debit', 300);
    const produit = await entry('7111', 'credit', 500);
    await an.analyticRepository.ventilate({ lineIds: [charge.line], axisId: axis, keyId: key.id }, actor);
    await an.analyticRepository.ventilate({ lineIds: [produit.line], axisId: axis, costCenterId: sec.BOU }, actor);
    expect(await ventil(charge.line)).toEqual([
      { code: `BOU${tag}`, amount: 180, source: 'key' }, { code: `PAT${tag}`, amount: 120, source: 'key' },
    ]);

    const b = await an.analyticRepository.balance({ axisId: axis, from: day, to: day });
    expect(sectionOf(b, `BOU${tag}`)).toMatchObject({ produits: 500, charges: 180, result: 320 });
    expect(sectionOf(b, `PAT${tag}`)).toMatchObject({ produits: 0, charges: 120, result: -120 });
    const { financialStatementsRepository } = await import('../../repositories/ledger.repository.js');
    const cpc = await financialStatementsRepository.incomeStatement({ startDate: day, endDate: day });
    const sum = (k: 'produits' | 'charges') => Math.round((b.sections.reduce((s, x) => s + x[k], 0) + b.unventilated[k]) * 100) / 100;
    expect(sum('produits')).toBe(Math.round(cpc.total_produits * 100) / 100);
    expect(sum('charges')).toBe(Math.round(cpc.total_charges * 100) / 100);
    expect(b.totals.result).toBe(Math.round(cpc.resultat_net * 100) / 100);
  });

  it('la base refuse une ventilation incomplète ou sur un compte de bilan', async () => {
    const charge = await entry('6181', 'debit', 50);
    await expect(testPool().query(
      `INSERT INTO journal_line_analytics (journal_entry_line_id, axis_id, cost_center_id, amount) VALUES ($1, $2, $3, 20)`,
      [charge.line, axis, sec.BOU])).rejects.toThrow(/incomplète/);
    const caisse = (await testPool().query(`SELECT id FROM journal_entry_lines WHERE journal_entry_id = $1 AND account_id = $2`, [charge.entryId, acc['5161']])).rows[0].id;
    await expect(an.analyticRepository.ventilate({ lineIds: [caisse], axisId: axis, costCenterId: sec.BOU }, actor)).rejects.toThrow(/charges \(6\)/);
  });

  it('l\'extourne reprend la ventilation : la section revient à zéro', async () => {
    const charge = await entry('6181', 'debit', 77);
    await an.analyticRepository.ventilate({ lineIds: [charge.line], axisId: axis, costCenterId: sec.PAT }, actor);
    const before = sectionOf(await an.analyticRepository.balance({ axisId: axis, from: day, to: day }), `PAT${tag}`).charges;
    await manual.reverse(charge.entryId, { reason: `test ${tag}` }, actor);
    const after = sectionOf(await an.analyticRepository.balance({ axisId: axis, from: day, to: day }), `PAT${tag}`).charges;
    expect(Math.round((before - after) * 100) / 100).toBe(77);
  });

  it('une facture affectée à un centre ventile ses charges, sans écraser une ventilation manuelle', async () => {
    const p = testPool();
    const supplier = (await p.query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`Fournisseur analytique ${tag}`])).rows[0].id;
    const aux = (await p.query(`SELECT id FROM account_auxiliaries WHERE supplier_id = $1`, [supplier])).rows[0].id;
    const amount = 100 + Math.floor(Math.random() * 9000) / 100;
    const inv = (await p.query(
      `INSERT INTO invoices (invoice_number, invoice_type, supplier_id, invoice_date, amount, total_amount, status)
       VALUES ($1, 'received', $2, $3, $4, $4, 'pending') RETURNING id`, [`FA-AN-${tag}`, supplier, day, amount])).rows[0].id;
    const e = (await p.query(
      `INSERT INTO journal_entries (entry_number, journal_id, entry_date, fiscal_period_id, description, source_kind, source_id, created_by)
       SELECT $1::text, j.id, $2::date, fn_ensure_fiscal_period($2::date), $1::text, 'backfill', $3, $4 FROM journals j WHERE j.code = 'AC' RETURNING id`,
      [`AN-${tag}`, day, inv, actor.userId])).rows[0].id;
    await p.query(
      `INSERT INTO journal_entry_lines (journal_entry_id, line_order, account_id, auxiliary_id, debit, credit)
       VALUES ($1, 1, $2, NULL, $4, 0), ($1, 2, $3, $5, 0, $4)`, [e, acc['6181'], acc['4411'], amount, aux]);
    await p.query(`UPDATE journal_entries SET status = 'posted', posted_at = now(), posted_by = $2 WHERE id = $1`, [e, actor.userId]);
    const line = (await p.query(`SELECT id FROM journal_entry_lines WHERE journal_entry_id = $1 AND line_order = 1`, [e])).rows[0].id;
    expect(await ventil(line)).toEqual([]);

    await p.query(`UPDATE invoices SET cost_center_id = $2 WHERE id = $1`, [inv, sec.BOU]);
    expect(await ventil(line)).toEqual([{ code: `BOU${tag}`, amount, source: 'invoice' }]);

    // Réimputation manuelle, puis changement de centre de la facture : la saisie manuelle reste.
    await an.analyticRepository.ventilate({ lineIds: [line], axisId: axis, costCenterId: sec.PAT }, actor);
    await p.query(`UPDATE invoices SET cost_center_id = NULL WHERE id = $1`, [inv]);
    await p.query(`UPDATE invoices SET cost_center_id = $2 WHERE id = $1`, [inv, sec.BOU]);
    expect(await ventil(line)).toEqual([{ code: `PAT${tag}`, amount, source: 'manual' }]);
  });
});
