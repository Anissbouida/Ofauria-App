/**
 * G4-02 — rapprochement bancaire par règles.
 * Relevé d'essai de six lignes sur un compte de banque propre au test :
 *   L1  virement émis « VIR FA-xxx » = règlement de cette facture        → référence (100)
 *   L2  « FRAIS TENUE DE COMPTE » sans écriture                           → règle : écriture générée (95)
 *   L3  prélèvement au montant unique d'une écriture à 3 jours            → montant (80)
 *   L4  virement reçu = somme de deux encaissements                       → regroupement (70)
 *   L5  montant porté par DEUX écritures                                   → ambigu, non proposé
 *   L6  opération inconnue                                                  → rien
 * Mesure demandée par le plan : taux de rapprochement automatique avant (ancien moteur :
 * montant exact unique) et après.
 */
import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Rapprochement bancaire par règles (G4-02)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let engine: typeof import('../../services/bank-matching.js');
  let rules: typeof import('../../repositories/bank-reconciliation.repository.js')['bankRuleRepository'];
  let recon: typeof import('../../repositories/bank-reconciliation.repository.js')['bankReconciliationRepository'];
  let actor: { userId: string; storeId: string | null };
  let bankAccount: string, statementId: string, ruleId: string;
  const acc: Record<string, string> = {};
  const lineIds: Record<string, string> = {};
  const day = '2027-03-15';
  const ref = `FA-${RUN.slice(-6).toUpperCase()}`;
  const p = () => testPool();

  /** Écriture au journal de banque : `side` = sens côté banque. */
  const entry = async (date: string, side: 'in' | 'out', amount: number, pieceRef: string | null = null) => {
    const e = (await p().query(
      `INSERT INTO journal_entries (entry_number, journal_id, entry_date, fiscal_period_id, description, source_kind, created_by, piece_ref)
       SELECT $1::text, j.id, $2::date, fn_ensure_fiscal_period($2::date), $1::text, 'backfill', $3, $4 FROM journals j WHERE j.code = 'BQ' RETURNING id`,
      [`BQ-${crypto.randomUUID().slice(0, 8)}`, date, actor.userId, pieceRef])).rows[0].id;
    await p().query(
      `INSERT INTO journal_entry_lines (journal_entry_id, line_order, account_id, debit, credit) VALUES ($1, 1, $2, $3, $4), ($1, 2, $5, $4, $3)`,
      [e, bankAccount, side === 'in' ? amount : 0, side === 'out' ? amount : 0, acc['6181']]);
    await p().query(`UPDATE journal_entries SET status = 'posted', posted_at = now(), posted_by = $2 WHERE id = $1`, [e, actor.userId]);
    return (await p().query(`SELECT id FROM journal_entry_lines WHERE journal_entry_id = $1 AND account_id = $2`, [e, bankAccount])).rows[0].id as string;
  };

  beforeAll(async () => {
    repos = await importRepositories();
    engine = await import('../../services/bank-matching.js');
    ({ bankRuleRepository: rules, bankReconciliationRepository: recon } = await import('../../repositories/bank-reconciliation.repository.js'));
    const admin = (await p().query(`SELECT id, store_id FROM users WHERE role = 'admin' AND NOT is_system ORDER BY created_at LIMIT 1`)).rows[0];
    actor = { userId: admin.id, storeId: admin.store_id ?? null };
    for (const r of (await p().query(`SELECT id, code FROM accounts WHERE code IN ('6181', '6147', '5141')`)).rows) acc[r.code] = r.id;
    // Compte de banque propre au test (sous 5141) : aucune autre suite n'y écrit.
    const code = `5141${String(Date.now()).slice(-4)}`;
    bankAccount = (await p().query(
      `INSERT INTO accounts (code, label, parent_id, account_class, rubrique, poste, account_type, normal_side, is_active)
       SELECT $1, $2, id, account_class, rubrique, poste, account_type, normal_side, true FROM accounts WHERE code = '5141' RETURNING id`, [code, `Banque test ${RUN}`])).rows[0].id;

    await entry('2027-03-14', 'out', 1234.5, ref);       // L1 : règlement portant la référence
    await entry('2027-03-12', 'out', 777.77);             // L3 : montant unique
    await entry('2027-03-15', 'in', 100);                 // L4 : regroupement 100 + 200
    await entry('2027-03-16', 'in', 200);
    await entry('2027-03-14', 'out', 50.5);               // L5 : deux écritures de même montant
    await entry('2027-03-16', 'out', 50.5);

    ruleId = (await rules.save({ label: `Frais de tenue ${RUN}`, labelContains: 'FRAIS TENUE', direction: 'out', action: 'post_entry',
      counterAccountId: acc['6147'], entryLabel: 'Frais bancaires' }, actor.userId)).id;

    statementId = (await p().query(
      `INSERT INTO bank_statements (label, account_id, statement_date, opening_balance, closing_balance, created_by)
       VALUES ($1, $2, $3, 0, 0, $4) RETURNING id`, [`Relevé test ${RUN}`, bankAccount, day, actor.userId])).rows[0].id;
    const line = async (k: string, label: string, amount: number, direction: 'in' | 'out', date = day) => {
      lineIds[k] = (await p().query(
        `INSERT INTO bank_statement_lines (bank_statement_id, operation_date, label, amount, direction) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [statementId, date, label, amount, direction])).rows[0].id;
    };
    await line('L1', `VIR SEPA FOURNISSEUR ${ref}`, 1234.5, 'out');
    await line('L2', 'FRAIS TENUE DE COMPTE MARS', 45, 'out');
    await line('L3', 'PRLV SOCIETE X', 777.77, 'out');
    await line('L4', 'VIR RECU CLIENT Y', 300, 'in');
    await line('L5', 'PRLV INCONNU', 50.5, 'out');
    await line('L6', 'OPERATION DIVERSE', 12.34, 'in');
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM bank_statements WHERE id = $1`, [statementId]).catch(() => undefined);
    await p().query(`DELETE FROM bank_rules WHERE id = $1`, [ruleId]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('propositions : une par passe, ambigu et inconnu laissés de côté ; rien n\'est écrit', async () => {
    const { unmatched, proposals } = await engine.bankMatching.propose(statementId);
    expect(unmatched).toBe(6);
    const by = Object.fromEntries(proposals.map(x => [Object.entries(lineIds).find(([, id]) => id === x.bankLineId)![0], x]));
    expect(Object.keys(by).sort()).toEqual(['L1', 'L2', 'L3', 'L4']);
    expect(by.L1).toMatchObject({ method: 'reference', confidence: 100 });
    expect(by.L2).toMatchObject({ method: 'rule', confidence: 95, ruleId, generate: { counterAccountId: acc['6147'], label: 'Frais bancaires' } });
    expect(by.L3).toMatchObject({ method: 'amount', confidence: 80 });
    expect(by.L4).toMatchObject({ method: 'group', confidence: 70 });
    expect(by.L4.entryLineIds).toHaveLength(2);
    expect((await p().query(`SELECT COUNT(*)::int AS n FROM bank_statement_lines WHERE bank_statement_id = $1 AND reconciled`, [statementId])).rows[0].n).toBe(0);
  });

  it('taux avant / après : l\'ancien moteur (montant exact unique) rapprochait 2 lignes sur 6, le nouveau en propose 4', async () => {
    // Ancien moteur : montant exact à ± 7 jours, candidat unique — L1 et L3 seulement.
    const before = (await p().query(
      `SELECT COUNT(*)::int AS n FROM bank_statement_lines b
        WHERE b.bank_statement_id = $1
          AND (SELECT COUNT(*) FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id
                WHERE jel.account_id = $2 AND (CASE WHEN b.direction = 'in' THEN jel.debit ELSE jel.credit END) = b.amount
                  AND je.entry_date BETWEEN b.operation_date - 7 AND b.operation_date + 7) = 1`, [statementId, bankAccount])).rows[0].n;
    const after = (await engine.bankMatching.propose(statementId)).proposals.length;
    expect(before).toBe(2);
    expect(after).toBe(4);
  });

  it('rapprochement automatique (≥ 80) : écriture de frais générée, regroupement laissé à valider', async () => {
    const out = await recon.autoMatch(statementId, actor.userId, actor.storeId);
    expect(out).toMatchObject({ matched: 3, proposed: 4, errors: [] });
    const rows = (await p().query(
      `SELECT id, reconciled, match_method, generated_entry_id FROM bank_statement_lines WHERE bank_statement_id = $1`, [statementId])).rows;
    const st = Object.fromEntries(rows.map(r => [Object.entries(lineIds).find(([, id]) => id === r.id)![0], r]));
    expect(['L1', 'L2', 'L3'].every(k => st[k].reconciled)).toBe(true);
    expect(st.L4.reconciled).toBe(false);
    // L2 : l'écriture de frais existe, équilibrée, au journal de banque, sur 6147.
    const gen = (await p().query(
      `SELECT j.code, SUM(l.debit)::float8 AS d, SUM(l.credit)::float8 AS c, bool_or(l.account_id = $2 AND l.debit = 45) AS fee
         FROM journal_entries je JOIN journals j ON j.id = je.journal_id JOIN journal_entry_lines l ON l.journal_entry_id = je.id
        WHERE je.id = $1 GROUP BY j.code`, [st.L2.generated_entry_id, acc['6147']])).rows[0];
    expect(gen).toMatchObject({ code: 'BQ', d: 45, c: 45, fee: true });
  }, 60_000);

  it('validation du regroupement : une ligne de relevé solde deux écritures ; défaire libère les deux', async () => {
    expect(await engine.bankMatching.apply(statementId, { userId: actor.userId, bankLineIds: [lineIds.L4] })).toMatchObject({ applied: 1 });
    const matches = (await p().query(`SELECT COUNT(*)::int AS n FROM bank_statement_line_matches WHERE bank_line_id = $1`, [lineIds.L4])).rows[0].n;
    expect(matches).toBe(2);
    const view = (await recon.getReconciliation(statementId))!;
    expect(view.summary.reconciled).toBe(4);
    expect(view.unmatchedLedgerLines.every((l: { debit: string }) => Number(l.debit) === 0)).toBe(true);   // les deux encaissements ne sont plus « à rapprocher »
    await recon.unmatchLine(lineIds.L4);
    expect((await p().query(`SELECT COUNT(*)::int AS n FROM bank_statement_line_matches WHERE bank_line_id = $1`, [lineIds.L4])).rows[0].n).toBe(0);
    expect((await engine.bankMatching.propose(statementId)).proposals.map(x => x.bankLineId)).toContain(lineIds.L4);
  });

  it('règle : condition obligatoire, compte requis pour générer, expression valide', async () => {
    await expect(rules.save({ label: 'Vide', action: 'match' }, actor.userId)).rejects.toThrow(/au moins une condition/);
    await expect(rules.save({ label: 'Sans compte', labelContains: 'AGIOS', action: 'post_entry' }, actor.userId)).rejects.toThrow(/compte de contrepartie/);
    await expect(rules.save({ label: 'Regex', labelRegex: '([', action: 'match' }, actor.userId)).rejects.toThrow(/Expression régulière invalide/);
    expect(engine.ruleMatches({ id: 'x', priority: 1, label: 'x', label_contains: null, label_regex: '^COM\\s*CB', direction: 'out', amount_min: 1, amount_max: 100,
      action: 'match', counter_account_id: null, entry_label: null, amount_tolerance: 0, date_tolerance_days: 3 },
      { id: 'l', operation_date: day, label: 'com cb mars', reference: null, amount: 12, direction: 'out' })).toBe(true);
  });
});
