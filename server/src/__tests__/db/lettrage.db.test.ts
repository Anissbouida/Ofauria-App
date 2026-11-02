/**
 * Lettrage manuel (mig 420) — intégration base migrée.
 *
 *   1. Facture + deux règlements partiels d'un même tiers : lettrés ensemble,
 *      code A, trace « letter » au nom de l'utilisateur ; délettrage du groupe.
 *   2. Refus : sélection non soldée, tiers différents, compte non lettrable,
 *      ligne déjà lettrée, écriture en brouillon.
 *   3. Garde en base (au COMMIT) : délettrage partiel et groupe multi-tiers refusés.
 *   4. Lettrage automatique d'une facture reprise (backfill) soldée par ses
 *      règlements ; une facture partiellement payée reste ouverte.
 *   5. Exercice clôturé : son lettrage est figé (ni lettrage ni délettrage).
 */
import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Lettrage manuel', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let manual: typeof import('../../repositories/manual-entry.repository.js').manualEntryRepository;
  let lettrage: typeof import('../../repositories/lettrage.repository.js').lettrageRepository;
  let actor: { userId: string; storeId: string | null };
  const acc: Record<string, string> = {};
  let auxA: string, auxB: string;
  const day = new Date().toISOString().slice(0, 10);

  /** Écriture comptabilisée : une ligne sur le tiers, la contrepartie en caisse ou en charge.
   *  Journal CA, pas OD : manual-entry.db.test contrôle la séquence OD en parallèle. */
  const tiersEntry = async (aux: string, side: 'debit' | 'credit', amount: number, label: string, date = day) => {
    const tiersLine = { accountId: acc['4411'], auxiliaryId: aux, debit: side === 'debit' ? amount : 0, credit: side === 'credit' ? amount : 0, label };
    const other = { accountId: side === 'debit' ? acc['5161'] : acc['6181'], debit: side === 'credit' ? amount : 0, credit: side === 'debit' ? amount : 0 };
    const { id } = await manual.createAndPost({ journalCode: 'CA', date, description: `${label} ${RUN}`, lines: [tiersLine, other] }, actor);
    return (await testPool().query(
      `SELECT id FROM journal_entry_lines WHERE journal_entry_id = $1 AND account_id = $2`, [id, acc['4411']])).rows[0].id as string;
  };
  const lettrageOf = async (lineId: string) =>
    (await testPool().query(`SELECT lettrage_id FROM journal_entry_lines WHERE id = $1`, [lineId])).rows[0].lettrage_id as string | null;

  beforeAll(async () => {
    repos = await importRepositories();
    manual = (await import('../../repositories/manual-entry.repository.js')).manualEntryRepository;
    lettrage = (await import('../../repositories/lettrage.repository.js')).lettrageRepository;
    const p = testPool();
    const admin = (await p.query(`SELECT id, store_id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`)).rows[0];
    actor = { userId: admin.id, storeId: admin.store_id ?? null };
    for (const r of (await p.query(`SELECT id, code FROM accounts WHERE code IN ('6181', '5161', '4411')`)).rows) acc[r.code] = r.id;
    const aux = (await p.query(`SELECT id FROM account_auxiliaries WHERE account_id = $1 ORDER BY code LIMIT 2`, [acc['4411']])).rows;
    [auxA, auxB] = [aux[0].id, aux[1].id];
  });

  afterAll(async () => {
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('lettre une facture et ses deux règlements partiels, puis délettre le groupe', async () => {
    const facture = await tiersEntry(auxA, 'credit', 100, 'Facture');
    const r1 = await tiersEntry(auxA, 'debit', 60, 'Règlement 1');
    const r2 = await tiersEntry(auxA, 'debit', 40, 'Règlement 2');

    // Facture + un seul règlement : non soldé.
    await expect(lettrage.letter([facture, r1], actor)).rejects.toThrow(/écart de 40\.00 DH au crédit/);
    const out = await lettrage.letter([facture, r1, r2], actor);
    expect(out.lines).toBe(3);
    for (const l of [facture, r1, r2]) expect(await lettrageOf(l)).toBe(out.lettrage_id);

    const view = await lettrage.lines({ accountId: acc['4411'], auxiliaryId: auxA, status: 'lettered' });
    const mine = view.lines.filter((l: { lettrage_id: string | null }) => l.lettrage_id === out.lettrage_id);
    expect(mine).toHaveLength(3);
    expect(new Set(mine.map((l: { code: string | null }) => l.code)).size).toBe(1);
    expect(mine[0].code).toMatch(/^[A-Z]+$/);
    const open = await lettrage.lines({ accountId: acc['4411'], auxiliaryId: auxA, status: 'open' });
    expect(open.lines.some((l: { id: string }) => [facture, r1, r2].includes(l.id))).toBe(false);

    const trace = await testPool().query(
      `SELECT event, actor FROM ledger_audit_log WHERE lettrage_id = $1 ORDER BY id`, [out.lettrage_id]);
    expect(trace.rows.map((t: { event: string }) => t.event)).toEqual(['letter', 'letter', 'letter']);
    expect(trace.rows[0].actor).toBe(actor.userId);

    await lettrage.unletter(out.lettrage_id, actor);
    for (const l of [facture, r1, r2]) expect(await lettrageOf(l)).toBeNull();
    const un = await testPool().query(`SELECT 1 FROM ledger_audit_log WHERE lettrage_id = $1 AND event = 'unletter'`, [out.lettrage_id]);
    expect(un.rows).toHaveLength(3);
  });

  it('refuse les sélections incohérentes', async () => {
    const fA = await tiersEntry(auxA, 'credit', 25, 'Facture A');
    const rB = await tiersEntry(auxB, 'debit', 25, 'Règlement B');
    await expect(lettrage.letter([fA, rB], actor)).rejects.toThrow(/même tiers/);

    // Compte non lettrable (charge 6181).
    const { id } = await manual.createAndPost({ journalCode: 'CA', date: day, description: `Charges ${RUN}`, lines: [
      { accountId: acc['6181'], debit: 10, credit: 0 }, { accountId: acc['5161'], debit: 0, credit: 10 },
      { accountId: acc['6181'], debit: 0, credit: 10 }, { accountId: acc['5161'], debit: 10, credit: 0 },
    ] }, actor);
    const charges = (await testPool().query(
      `SELECT id FROM journal_entry_lines WHERE journal_entry_id = $1 AND account_id = $2`, [id, acc['6181']])).rows.map((r: { id: string }) => r.id);
    await expect(lettrage.letter(charges, actor)).rejects.toThrow(/ne se lettre pas/);

    // Ligne déjà lettrée.
    const rA = await tiersEntry(auxA, 'debit', 25, 'Règlement A');
    await lettrage.letter([fA, rA], actor);
    const rA2 = await tiersEntry(auxA, 'debit', 25, 'Règlement A bis');
    await expect(lettrage.letter([fA, rA2], actor)).rejects.toThrow(/déjà lettrée/);

    // Brouillon.
    const draft = await manual.createDraft({ journalCode: 'CA', date: day, description: `Brouillon ${RUN}`, lines: [
      { accountId: acc['4411'], auxiliaryId: auxA, debit: 0, credit: 25 }, { accountId: acc['6181'], debit: 25, credit: 0 },
    ] }, actor);
    const draftLine = (await testPool().query(
      `SELECT id FROM journal_entry_lines WHERE journal_entry_id = $1 AND account_id = $2`, [draft.id, acc['4411']])).rows[0].id;
    await expect(lettrage.letter([draftLine, rA2], actor)).rejects.toThrow(/brouillon/);
    await manual.deleteDraft(draft.id, actor);
  });

  it('la base refuse au COMMIT un délettrage partiel et un groupe multi-tiers', async () => {
    const f = await tiersEntry(auxA, 'credit', 70, 'Facture garde');
    const r1 = await tiersEntry(auxA, 'debit', 30, 'Règlement garde 1');
    const r2 = await tiersEntry(auxA, 'debit', 40, 'Règlement garde 2');
    const { lettrage_id } = await lettrage.letter([f, r1, r2], actor);
    const p = testPool();
    await expect(p.query(`UPDATE journal_entry_lines SET lettrage_id = NULL WHERE id = $1`, [r2])).rejects.toThrow(/non soldé/);
    expect(await lettrageOf(r2)).toBe(lettrage_id);

    const fB = await tiersEntry(auxB, 'credit', 15, 'Facture autre tiers');
    const rA = await tiersEntry(auxA, 'debit', 15, 'Règlement autre tiers');
    await expect(p.query(
      `UPDATE journal_entry_lines SET lettrage_id = $2 WHERE id = ANY($1::uuid[])`, [[fB, rA], crypto.randomUUID()])).rejects.toThrow(/un seul compte et un seul tiers/);
  });

  it('lettre automatiquement une facture reprise avec ses règlements, pas une facture partiellement payée', async () => {
    const p = testPool();
    // Fournisseur propre au test : d'autres suites créent factures et règlements en parallèle.
    const supplier = (await p.query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`Fournisseur lettrage ${RUN}`])).rows[0].id;
    const auxS = (await p.query(`SELECT id FROM account_auxiliaries WHERE supplier_id = $1`, [supplier])).rows[0].id;
    // Pièces et écritures « backfill » : la reprise d'historique ne lettrait pas.
    const invoice = async (n: string, total: number, paid: number[]) => {
      const inv = (await p.query(
        `INSERT INTO invoices (invoice_number, invoice_type, supplier_id, invoice_date, amount, total_amount, status)
         VALUES ($1, 'received', $2, $3, $4, $4, 'pending') RETURNING id`, [`${n}-${RUN}`, supplier, day, total])).rows[0].id;
      const entry = async (sourceId: string, tiers: 'debit' | 'credit', amount: number, other: string) => {
        const e = (await p.query(
          `INSERT INTO journal_entries (entry_number, journal_id, entry_date, fiscal_period_id, description, source_kind, source_id, created_by)
           SELECT $1::text, j.id, $2::date, fn_ensure_fiscal_period($2::date), $1::text, 'backfill', $3, $4 FROM journals j WHERE j.code = 'OD' RETURNING id`,
          [`BF-${crypto.randomUUID().slice(0, 8)}`, day, sourceId, actor.userId])).rows[0].id;
        await p.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, line_order, account_id, auxiliary_id, debit, credit)
           VALUES ($1, 1, $2, $3, $4, $5), ($1, 2, $6, NULL, $5, $4)`,
          [e, acc['4411'], auxS, tiers === 'debit' ? amount : 0, tiers === 'credit' ? amount : 0, other]);
        await p.query(`UPDATE journal_entries SET status = 'posted', posted_at = now(), posted_by = $2 WHERE id = $1`, [e, actor.userId]);
      };
      await entry(inv, 'credit', total, acc['6181']);
      for (const amount of paid) {
        const pay = (await p.query(
          `INSERT INTO payments (type, invoice_id, supplier_id, amount, payment_date, payment_method, payment_mode, reference)
           VALUES ('invoice', $1, $2, $3, $4, 'virement', 'virement', $5) RETURNING id`, [inv, supplier, amount, day, `VIR-${crypto.randomUUID().slice(0, 8)}`])).rows[0].id;
        await entry(pay, 'debit', amount, acc['5161']);
      }
      return inv as string;
    };
    // Montants propres à chaque passage : la détection de doublons bloquerait le paiement.
    const k = Math.round(Math.random() * 90000) / 100;
    const soldee = await invoice('FA-AUTO', 90 + k, [50 + k, 40]);
    const partielle = await invoice('FA-PART', 190 + k, [50]);
    const linesOf = async (inv: string) => (await p.query(
      `SELECT jel.lettrage_id FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id
        WHERE jel.account_id = $2 AND (je.source_id = $1 OR je.source_id IN (SELECT id FROM payments WHERE invoice_id = $1))`,
      [inv, acc['4411']])).rows.map((r: { lettrage_id: string | null }) => r.lettrage_id);

    const scope = { accountId: acc['4411'], auxiliaryId: auxS };
    expect(await lettrage.autoLetter({ ...scope, dryRun: true }, actor)).toEqual({ invoices: 1, lines: 3 });
    expect(await linesOf(soldee)).toEqual([null, null, null]);              // l'aperçu ne lettre rien
    expect(await lettrage.autoLetter(scope, actor)).toEqual({ invoices: 1, lines: 3 });
    const l1 = await linesOf(soldee);
    expect(l1[0]).not.toBeNull();
    expect(new Set(l1).size).toBe(1);
    expect(await linesOf(partielle)).toEqual([null, null]);
    expect((await lettrage.autoLetter({ ...scope, dryRun: true }, actor)).invoices).toBe(0);
  });

  it('fige le lettrage d\'un exercice clôturé', async () => {
    // Exercice 2020 réservé à ce test : préparé puis clôturé une fois pour toutes
    // (une clôture est définitive, la base de test la garde d'un passage à l'autre).
    const p = testPool();
    const label = 'Lettrage exercice clos';
    const closed = (await p.query(`SELECT status FROM fiscal_years WHERE year = 2020`)).rows[0]?.status === 'closed';
    if (!closed) {
      const f1 = await tiersEntry(auxA, 'credit', 12, `${label} facture`, '2020-06-15');
      const r1 = await tiersEntry(auxA, 'debit', 12, `${label} règlement`, '2020-06-20');
      await tiersEntry(auxA, 'credit', 8, `${label} facture ouverte`, '2020-06-15');
      await tiersEntry(auxA, 'debit', 8, `${label} règlement ouvert`, '2020-06-20');
      await lettrage.letter([f1, r1], actor);
      await p.query(`UPDATE fiscal_years SET status = 'closed', closed_at = now(), closed_by = $1 WHERE year = 2020`, [actor.userId]);
    }
    const lines = (await p.query(
      `SELECT jel.id, jel.lettrage_id FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id
        WHERE je.entry_date BETWEEN '2020-01-01' AND '2020-12-31' AND jel.account_id = $1 AND je.description LIKE $2
        ORDER BY je.entry_date, je.description`, [acc['4411'], `${label}%`])).rows;
    const open = lines.filter((l: { lettrage_id: string | null }) => !l.lettrage_id).map((l: { id: string }) => l.id);
    const group = lines.find((l: { lettrage_id: string | null }) => l.lettrage_id)!.lettrage_id;
    expect(open.length).toBeGreaterThanOrEqual(2);
    await expect(lettrage.letter(open, actor)).rejects.toThrow(/exercice 2020 clôturé/);
    await expect(lettrage.unletter(group, actor)).rejects.toThrow(/exercice 2020 clôturé/);
    const view = await lettrage.lines({ accountId: acc['4411'], auxiliaryId: auxA, status: 'all', from: '2020-01-01', to: '2020-12-31' });
    expect(view.lines.every((l: { frozen: boolean }) => l.frozen)).toBe(true);
  });
});
