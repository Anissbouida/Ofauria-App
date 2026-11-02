/**
 * Saisie libre d'écritures (mig 418) — intégration base migrée.
 *
 *   1. Brouillon : numéro provisoire, modifiable ; la comptabilisation attribue
 *      le numéro de journal définitif et garde la pièce justificative.
 *   2. Un brouillon supprimé ne consomme aucun numéro (séquence continue).
 *   3. Refus : écriture déséquilibrée, compte collectif sans tiers, AN.
 *   4. Extourne motivée, au nom de l'auteur ; refusée pour une écriture née
 *      d'une pièce (elle se corrige depuis la pièce).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Saisie libre d\'écritures', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let manual: typeof import('../../repositories/manual-entry.repository.js').manualEntryRepository;
  let actor: { userId: string; storeId: string | null };
  const acc: Record<string, string> = {};
  let aux4411: string;
  const day = new Date().toISOString().slice(0, 10);
  const year = Number(day.slice(0, 4));

  // Journal propre au test : les autres suites passent des OD en parallèle et
  // fausseraient le contrôle de la numérotation continue.
  const JR = 'TSL';
  const base = (over: Partial<Parameters<typeof manual.createDraft>[0]> = {}) => ({
    journalCode: JR, date: day, description: `OD test ${RUN}`, pieceRef: `PIECE-${RUN}`, pieceDate: day,
    lines: [
      { accountId: acc['6181'], debit: 80, credit: 0, label: 'Charge' },
      { accountId: acc['5161'], debit: 0, credit: 80, label: 'Caisse' },
    ],
    ...over,
  });
  const odSeq = async () => Number((await testPool().query(
    `SELECT COALESCE(max(current_seq), 0) AS n FROM journal_sequences s JOIN journals j ON j.id = s.journal_id WHERE j.code = $2 AND s.year = $1`,
    [year, JR])).rows[0].n);

  beforeAll(async () => {
    repos = await importRepositories();
    manual = (await import('../../repositories/manual-entry.repository.js')).manualEntryRepository;
    const p = testPool();
    await p.query(`INSERT INTO journals (code, label, kind) VALUES ($1, 'Saisie libre (tests)', 'misc') ON CONFLICT (code) DO NOTHING`, [JR]);
    const admin = (await p.query(`SELECT id, store_id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`)).rows[0];
    actor = { userId: admin.id, storeId: admin.store_id ?? null };
    for (const r of (await p.query(`SELECT id, code FROM accounts WHERE code IN ('6181', '5161', '4411')`)).rows) acc[r.code] = r.id;
    aux4411 = (await p.query(`SELECT id FROM account_auxiliaries WHERE account_id = $1 LIMIT 1`, [acc['4411']])).rows[0].id;
  });

  afterAll(async () => {
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('brouillon modifiable puis comptabilisé sous son numéro définitif, pièce conservée', async () => {
    const before = await odSeq();
    const { id } = await manual.createDraft(base(), actor);
    let e = (await testPool().query(`SELECT entry_number, status FROM journal_entries WHERE id = $1`, [id])).rows[0];
    expect(e.status).toBe('draft');
    expect(e.entry_number).toMatch(/^BROUILLON-/);
    expect(await odSeq()).toBe(before);                                   // aucun numéro consommé

    await manual.updateDraft(id, base({ description: `OD modifiée ${RUN}`, lines: [
      { accountId: acc['6181'], debit: 95.5, credit: 0 },
      { accountId: acc['5161'], debit: 0, credit: 95.5 },
    ] }), actor);
    const posted = await manual.post(id, actor);
    expect(posted.entry_number).toMatch(new RegExp(`^${JR}-${year}-\\d{5}$`));
    e = (await testPool().query(
      `SELECT status, description, piece_ref, posted_by, (SELECT sum(debit) FROM journal_entry_lines WHERE journal_entry_id = $1) AS total
         FROM journal_entries WHERE id = $1`, [id])).rows[0];
    expect(e).toMatchObject({ status: 'posted', description: `OD modifiée ${RUN}`, piece_ref: `PIECE-${RUN}`, posted_by: actor.userId });
    expect(Number(e.total)).toBe(95.5);
    await expect(manual.updateDraft(id, base(), actor)).rejects.toThrow(/brouillon/);
  });

  it('un brouillon supprimé ne laisse pas de trou dans la numérotation', async () => {
    const before = await odSeq();
    const { id } = await manual.createDraft(base(), actor);
    await manual.deleteDraft(id, actor);
    expect((await testPool().query(`SELECT 1 FROM journal_entries WHERE id = $1`, [id])).rows).toHaveLength(0);
    expect(await odSeq()).toBe(before);
    const trace = await testPool().query(`SELECT 1 FROM ledger_audit_log WHERE event = 'draft_delete' AND entry_id = $1`, [id]);
    expect(trace.rows).toHaveLength(1);
  });

  it('refuse une écriture déséquilibrée, un collectif sans tiers et le journal des à-nouveaux', async () => {
    await expect(manual.createDraft(base({ lines: [
      { accountId: acc['6181'], debit: 80, credit: 0 },
      { accountId: acc['5161'], debit: 0, credit: 79.99 },
    ] }), actor)).rejects.toThrow(/déséquilibrée/);
    await expect(manual.createDraft(base({ lines: [
      { accountId: acc['6181'], debit: 50, credit: 0 },
      { accountId: acc['4411'], debit: 0, credit: 50 },
    ] }), actor)).rejects.toThrow(/collectif/);
    await expect(manual.createDraft(base({ journalCode: 'AN' }), actor)).rejects.toThrow(/à-nouveaux/);
    // Avec son tiers, la même écriture passe.
    const ok = await manual.createAndPost(base({ lines: [
      { accountId: acc['6181'], debit: 50, credit: 0 },
      { accountId: acc['4411'], auxiliaryId: aux4411, debit: 0, credit: 50 },
    ] }), actor);
    expect(ok.entry_number).toMatch(new RegExp(`^${JR}-`));
  });

  it('extourne une écriture manuelle avec motif, refuse celle née d\'une pièce', async () => {
    const { id, entry_number } = await manual.createAndPost(base(), actor);
    const r = await manual.reverse(id, { reason: `Erreur d'imputation ${RUN}` }, actor);
    expect(r.reversal_number).toMatch(new RegExp(`^${JR}-`));
    const rows = (await testPool().query(
      `SELECT o.status, x.posted_by, x.description FROM journal_entries o JOIN journal_entries x ON x.id = o.reversed_by_entry_id WHERE o.id = $1`, [id])).rows[0];
    expect(rows.status).toBe('reversed');
    expect(rows.posted_by).toBe(actor.userId);
    expect(rows.description).toContain(`Extourne de ${entry_number} — motif : Erreur d'imputation ${RUN}`);
    await expect(manual.reverse(id, { reason: 'deux fois' }, actor)).rejects.toThrow(/non extournée/);

    // Écriture « née d'une pièce » (paiement) : l'extourne manuelle est refusée.
    const p = testPool();
    const pay = (await p.query(
      `INSERT INTO journal_entries (entry_number, journal_id, entry_date, fiscal_period_id, description, source_kind, created_by)
       SELECT $1, j.id, $2::date, fn_ensure_fiscal_period($2::date), 'Paiement test', 'payment', $3 FROM journals j WHERE j.code = 'OD' RETURNING id`,
      [`PAYTEST-${RUN}`, day, actor.userId])).rows[0].id;
    await p.query(
      `INSERT INTO journal_entry_lines (journal_entry_id, line_order, account_id, debit, credit)
       VALUES ($1, 1, $2, 10, 0), ($1, 2, $3, 0, 10)`, [pay, acc['6181'], acc['5161']]);
    await p.query(`UPDATE journal_entries SET status = 'posted', posted_at = now(), posted_by = $2 WHERE id = $1`, [pay, actor.userId]);
    await expect(manual.reverse(pay, { reason: 'test' }, actor)).rejects.toThrow(/corrigez ou annulez la pièce/);
  });
});
