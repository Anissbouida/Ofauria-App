/**
 * G4-02 — règle « commission de carte » (mig 601) : le flux TPE NET est rapproché des
 * encaissements carte BRUTS d'un jour (ou de jours consécutifs), l'écart est passé en
 * commission (6147) au journal de banque, dans les tolérances de la règle.
 *
 * Compte de banque propre au test (sous 5141). Encaissements (montants côté banque) :
 *   J1 2027-04-05 : vente carte 600,00 + saisie du jour 400,00           → brut 1 000,00
 *                   + un virement client 300,00 (pas une carte : ignoré)
 *   J2 2027-04-06 : saisie du jour 800,00 − écart carte de fermeture 20,00 → brut   780,00
 *   J3 2027-04-08 : saisie du jour 200,00 (déjà au net, taux mig 356 saisi)
 * Règle : libellé « REMISE TPE », écart 1 à 3 % du brut, écart négatif toléré 0,05, ± 3 jours.
 * Relevé :
 *   T1 2027-04-06  975,00 → J1 seul : 1 000 − 975 = 25,00 = 2,50 %       → commission 25,00
 *   T2 2027-04-07  760,50 → J2 seul :   780 − 760,50 = 19,50 = 2,50 %    → commission 19,50
 *                          (J1 : 23,95 % ; J1+J2 : 57,3 % — hors tolérance)
 *   T3 2027-04-09  500,00 → aucune combinaison dans 1-3 %                 → rien
 *   T4 2027-04-09  200,02 → J3 : écart −0,02 (≤ 0,05)                     → écart 0,02 au crédit de 6147
 */
import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Rapprochement — commission de carte (G4-02, mig 601)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let engine: typeof import('../../services/bank-matching.js');
  let rules: typeof import('../../repositories/bank-reconciliation.repository.js')['bankRuleRepository'];
  let recon: typeof import('../../repositories/bank-reconciliation.repository.js')['bankReconciliationRepository'];
  let actor: { userId: string; storeId: string | null };
  let bankAccount: string, statementId: string, ruleId: string, saleId: string;
  const acc: Record<string, string> = {};
  const L: Record<string, string> = {};     // lignes d'écriture côté banque
  const T: Record<string, string> = {};     // lignes du relevé
  const p = () => testPool();

  /** Écriture : `side` = sens côté banque ; `source` = nature de l'encaissement. */
  const entry = async (key: string, date: string, side: 'in' | 'out', amount: number, source: { kind: string; id?: string; detail?: string | null }) => {
    const e = (await p().query(
      `INSERT INTO journal_entries (entry_number, journal_id, entry_date, fiscal_period_id, description, source_kind, source_id, source_detail, created_by)
       SELECT $1::text, j.id, $2::date, fn_ensure_fiscal_period($2::date), $1::text, $3, $4, $5, $6 FROM journals j WHERE j.code = 'BQ' RETURNING id`,
      [`CB-${crypto.randomUUID().slice(0, 8)}`, date, source.kind, source.id ?? crypto.randomUUID(), source.detail ?? null, actor.userId])).rows[0].id;
    await p().query(
      `INSERT INTO journal_entry_lines (journal_entry_id, line_order, account_id, debit, credit) VALUES ($1, 1, $2, $3, $4), ($1, 2, $5, $4, $3)`,
      [e, bankAccount, side === 'in' ? amount : 0, side === 'out' ? amount : 0, acc['7111']]);
    await p().query(`UPDATE journal_entries SET status = 'posted', posted_at = now(), posted_by = $2 WHERE id = $1`, [e, actor.userId]);
    L[key] = (await p().query(`SELECT id FROM journal_entry_lines WHERE journal_entry_id = $1 AND account_id = $2`, [e, bankAccount])).rows[0].id;
  };

  beforeAll(async () => {
    repos = await importRepositories();
    engine = await import('../../services/bank-matching.js');
    ({ bankRuleRepository: rules, bankReconciliationRepository: recon } = await import('../../repositories/bank-reconciliation.repository.js'));
    const admin = (await p().query(`SELECT id, store_id FROM users WHERE role = 'admin' AND NOT is_system ORDER BY created_at LIMIT 1`)).rows[0];
    actor = { userId: admin.id, storeId: admin.store_id ?? null };
    for (const r of (await p().query(`SELECT id, code FROM accounts WHERE code IN ('7111', '6147', '5141')`)).rows) acc[r.code] = r.id;
    const code = `5141${String(Date.now()).slice(-5)}`;
    bankAccount = (await p().query(
      `INSERT INTO accounts (code, label, parent_id, account_class, rubrique, poste, account_type, normal_side, is_active)
       SELECT $1, $2, id, account_class, rubrique, poste, account_type, normal_side, true FROM accounts WHERE code = '5141' RETURNING id`, [code, `Banque TPE ${RUN}`])).rows[0].id;
    saleId = (await p().query(
      `INSERT INTO sales (sale_number, user_id, subtotal, total, payment_method) VALUES ($1, $2, 600, 600, 'card') RETURNING id`,
      [`TCB-${RUN}`, actor.userId])).rows[0].id;

    await entry('j1_sale', '2027-04-05', 'in', 600, { kind: 'sale', id: saleId, detail: `test-cb-${RUN}` });
    await entry('j1_shift', '2027-04-05', 'in', 400, { kind: 'shift_entry' });
    await entry('j1_transfer', '2027-04-05', 'in', 300, { kind: 'backfill' });
    await entry('j2_shift', '2027-04-06', 'in', 800, { kind: 'shift_entry' });
    await entry('j2_gap', '2027-04-06', 'out', 20, { kind: 'closure_diff', detail: 'card' });
    await entry('j3_shift', '2027-04-08', 'in', 200, { kind: 'shift_entry' });

    ruleId = (await rules.save({
      label: `Commission carte ${RUN}`, labelContains: 'REMISE TPE', action: 'match_fee', counterAccountId: acc['6147'], entryLabel: 'Commission carte',
      feePctMin: 1, feePctMax: 3, amountTolerance: 0.05, dateToleranceDays: 3, candidateSource: 'card',
    }, actor.userId)).id;

    statementId = (await p().query(
      `INSERT INTO bank_statements (label, account_id, statement_date, opening_balance, closing_balance, created_by)
       VALUES ($1, $2, '2027-04-10', 0, 0, $3) RETURNING id`, [`Relevé TPE ${RUN}`, bankAccount, actor.userId])).rows[0].id;
    for (const [k, date, label, amount] of [
      ['T1', '2027-04-06', 'REMISE TPE 0405 CMI', 975], ['T2', '2027-04-07', 'REMISE TPE 0406 CMI', 760.5],
      ['T3', '2027-04-09', 'REMISE TPE 0407 CMI', 500], ['T4', '2027-04-09', 'REMISE TPE 0408 CMI', 200.02],
    ] as const) {
      T[k] = (await p().query(
        `INSERT INTO bank_statement_lines (bank_statement_id, operation_date, label, amount, direction) VALUES ($1, $2, $3, $4, 'in') RETURNING id`,
        [statementId, date, label, amount])).rows[0].id;
    }
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM bank_statements WHERE id = $1`, [statementId]).catch(() => undefined);
    await p().query(`DELETE FROM bank_rules WHERE id = $1`, [ruleId]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  const key = (id: string) => Object.entries(T).find(([, v]) => v === id)![0];

  it('la règle se décrit : sens entrée, compte, écart en % ; contrôles', async () => {
    const r = (await rules.list()).find((x: { id: string }) => x.id === ruleId);
    expect(r).toMatchObject({ action: 'match_fee', direction: 'in', fee_pct_min: 1, fee_pct_max: 3, candidate_source: 'card', counter_account_code: '6147' });
    await expect(rules.save({ label: 'x', labelContains: 'TPE', action: 'match_fee', counterAccountId: acc['6147'] }, actor.userId)).rejects.toThrow(/écart maximal/);
    await expect(rules.save({ label: 'x', labelContains: 'TPE', action: 'match_fee', feePctMax: 3 }, actor.userId)).rejects.toThrow(/compte de contrepartie/);
    await expect(rules.save({ label: 'x', labelContains: 'TPE', action: 'match_fee', counterAccountId: acc['6147'], feePctMax: 3, direction: 'out' }, actor.userId)).rejects.toThrow(/flux reçu/);
    await expect(rules.save({ label: 'x', labelContains: 'TPE', action: 'match_fee', counterAccountId: acc['6147'], feePctMin: 4, feePctMax: 3 }, actor.userId)).rejects.toThrow(/écart minimal/);
  });

  it('propositions : T1 ← J1 (25,00 = 2,5 %), T2 ← J2 (19,50), T4 ← J3 (−0,02) ; T3 laissé', async () => {
    const { proposals } = await engine.bankMatching.propose(statementId);
    const by = Object.fromEntries(proposals.map(x => [key(x.bankLineId), x]));
    expect(Object.keys(by).sort()).toEqual(['T1', 'T2', 'T4']);
    expect(by.T1).toMatchObject({ method: 'rule', confidence: 90, ruleId, gross: 1000, feePct: 2.5, generate: { counterAccountId: acc['6147'], amount: 25 } });
    expect([...by.T1.entryLineIds].sort()).toEqual([L.j1_sale, L.j1_shift].sort());        // le virement client de J1 n'est pas une carte
    expect(by.T2).toMatchObject({ gross: 780, feePct: 2.5, generate: { amount: 19.5 } });
    expect([...by.T2.entryLineIds].sort()).toEqual([L.j2_shift, L.j2_gap].sort());
    expect(by.T4).toMatchObject({ gross: 200, generate: { amount: -0.02 } });
    expect(by.T4.entryLineIds).toEqual([L.j3_shift]);
  });

  it('rapprochement automatique : commissions générées, chaque ligne de relevé soldée au centime, aucune écriture existante modifiée', async () => {
    const before = (await p().query(
      `SELECT COUNT(*)::int AS n, SUM(debit)::float8 AS d, SUM(credit)::float8 AS c FROM journal_entry_lines WHERE id = ANY($1)`, [Object.values(L)])).rows[0];
    const out = await recon.autoMatch(statementId, actor.userId, actor.storeId);
    expect(out).toMatchObject({ matched: 3, errors: [] });

    const rows = Object.fromEntries((await p().query(
      `SELECT id, reconciled, match_method, match_rule_id, generated_entry_id FROM bank_statement_lines WHERE bank_statement_id = $1`, [statementId])).rows
      .map(r => [key(r.id), r]));
    expect(rows.T3.reconciled).toBe(false);
    for (const k of ['T1', 'T2', 'T4']) expect(rows[k]).toMatchObject({ reconciled: true, match_method: 'rule', match_rule_id: ruleId });

    // Somme (débit − crédit) des lignes rapprochées = montant du relevé.
    const solde = Object.fromEntries((await p().query(
      `SELECT m.bank_line_id, ROUND(SUM(l.debit - l.credit), 2)::float8 AS net, COUNT(*)::int AS n
         FROM bank_statement_line_matches m JOIN journal_entry_lines l ON l.id = m.entry_line_id
        WHERE m.bank_line_id = ANY($1) GROUP BY m.bank_line_id`, [Object.values(T)])).rows.map(r => [key(r.bank_line_id), r]));
    expect(solde.T1).toEqual({ bank_line_id: T.T1, net: 975, n: 3 });
    expect(solde.T2).toEqual({ bank_line_id: T.T2, net: 760.5, n: 3 });
    expect(solde.T4).toEqual({ bank_line_id: T.T4, net: 200.02, n: 2 });

    // Écritures générées : journal de banque, équilibrées, sur 6147.
    const gen = async (id: string) => (await p().query(
      `SELECT j.code, je.entry_date::text AS date, je.status,
              SUM(l.debit)::float8 AS d, SUM(l.credit)::float8 AS c,
              SUM(CASE WHEN l.account_id = $2 THEN l.debit - l.credit END)::float8 AS fee,
              SUM(CASE WHEN l.account_id = $3 THEN l.debit - l.credit END)::float8 AS bank
         FROM journal_entries je JOIN journals j ON j.id = je.journal_id JOIN journal_entry_lines l ON l.journal_entry_id = je.id
        WHERE je.id = $1 GROUP BY j.code, je.entry_date, je.status`, [id, acc['6147'], bankAccount])).rows[0];
    expect(await gen(rows.T1.generated_entry_id)).toEqual({ code: 'BQ', date: '2027-04-06', status: 'posted', d: 25, c: 25, fee: 25, bank: -25 });
    expect(await gen(rows.T2.generated_entry_id)).toEqual({ code: 'BQ', date: '2027-04-07', status: 'posted', d: 19.5, c: 19.5, fee: 19.5, bank: -19.5 });
    expect(await gen(rows.T4.generated_entry_id)).toEqual({ code: 'BQ', date: '2027-04-09', status: 'posted', d: 0.02, c: 0.02, fee: -0.02, bank: 0.02 });

    const after = (await p().query(
      `SELECT COUNT(*)::int AS n, SUM(debit)::float8 AS d, SUM(credit)::float8 AS c FROM journal_entry_lines WHERE id = ANY($1)`, [Object.values(L)])).rows[0];
    expect(after).toEqual(before);
    // Le virement client de J1 reste à rapprocher.
    expect((await p().query(`SELECT COUNT(*)::int AS n FROM bank_statement_line_matches WHERE entry_line_id = $1`, [L.j1_transfer])).rows[0].n).toBe(0);
  }, 60_000);

  it('défaire puis relancer : l\'écriture de commission existante est réutilisée, jamais doublée', async () => {
    const genId = (await p().query(`SELECT generated_entry_id FROM bank_statement_lines WHERE id = $1`, [T.T1])).rows[0].generated_entry_id;
    const count = async () => (await p().query(
      `SELECT COUNT(*)::int AS n FROM journal_entry_lines WHERE account_id = $1`, [acc['6147']])).rows[0].n;
    const n0 = await count();
    await recon.unmatchLine(T.T1);
    const out = await recon.autoMatch(statementId, actor.userId, actor.storeId);
    expect(out).toMatchObject({ matched: 1, errors: [] });
    expect(await count()).toBe(n0);
    const row = (await p().query(`SELECT reconciled, generated_entry_id FROM bank_statement_lines WHERE id = $1`, [T.T1])).rows[0];
    expect(row).toEqual({ reconciled: true, generated_entry_id: genId });
    const net = (await p().query(
      `SELECT ROUND(SUM(l.debit - l.credit), 2)::float8 AS net FROM bank_statement_line_matches m
         JOIN journal_entry_lines l ON l.id = m.entry_line_id WHERE m.bank_line_id = $1`, [T.T1])).rows[0].net;
    expect(net).toBe(975);
  }, 60_000);

  it('moteur pur : deux jours qui conviennent → ambigu, rien ; sans restriction carte, le virement fausse le brut', () => {
    const rule = { id: 'r', priority: 1, label: 'CB', label_contains: 'TPE', label_regex: null, direction: 'in' as const, amount_min: null, amount_max: null,
      action: 'match_fee' as const, counter_account_id: 'acc', entry_label: null, amount_tolerance: 0, date_tolerance_days: 3,
      fee_pct_min: 0, fee_pct_max: 3, candidate_source: 'card' as const };
    const line = { id: 'b', operation_date: '2027-05-03', label: 'REMISE TPE', reference: null, amount: 975, direction: 'in' as const };
    const c = (id: string, d: string, amount: number, card = true) => ({ id, entry_date: d, amount, side: 'in' as const, entry_number: id, refs: [], card });
    // Deux jours de 1 000 : chacun donne 2,5 % → ambigu.
    expect(engine.computeProposals([line], [c('a', '2027-05-01', 1000), c('b', '2027-05-02', 1000)], [rule])).toEqual([]);
    // Un encaissement non carte le même jour : ignoré avec la restriction, pris sans elle (brut 1 300 → 25 % : refusé).
    const cands = [c('a', '2027-05-02', 1000), c('v', '2027-05-02', 300, false)];
    expect(engine.computeProposals([line], cands, [rule])[0]).toMatchObject({ entryLineIds: ['a'], generate: { amount: 25 } });
    expect(engine.computeProposals([line], cands, [{ ...rule, candidate_source: null }])).toEqual([]);
    // Encaissement postérieur à l'opération : jamais candidat.
    expect(engine.computeProposals([line], [c('a', '2027-05-04', 1000)], [rule])).toEqual([]);
  });
});
