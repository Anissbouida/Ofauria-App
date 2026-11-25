/**
 * Plan d'action compta, étape 9 (audit C-12) — fonctions critiques du grand livre qui n'avaient
 * aucun test : numérotation sans trou sous concurrence, détection d'une écriture altérée par la
 * chaîne d'empreintes, verrou de période en base, invariant débit = crédit après des opérations
 * tirées au hasard (graine fixe, rejouable).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, type Fixtures } from './helpers.js';

/** Générateur pseudo-aléatoire à graine : un échec se rejoue avec la même graine. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEED = 20261124;

describe.skipIf(!hasTestDb)('Grand livre : numérotation, chaîne, verrou de période, invariant', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let gen: typeof import('../../services/journal-generator.service.js');
  let fx: Fixtures;
  const p = () => testPool();
  const LOCKED_DAY = '2027-09-10';

  type L = { account_code: string; debit: number; credit: number; label: string };
  const post = async (date: string, lines: L[], description = 'Test intégrité') => {
    const sourceId = (await p().query(`SELECT gen_random_uuid() AS id`)).rows[0].id as string;
    const c = await repos.db.getClient();
    try {
      await c.query('BEGIN');
      const r = await gen.persistEntry(c, {
        journal_code: 'OD', entry_date: date, description, source_kind: 'manual', source_id: sourceId, store_id: null, lines,
      }, { userId: fx.userId });
      await c.query('COMMIT');
      return r;
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  };
  const replica = async (sql: string, params: unknown[] = []) => {
    const c = await p().connect();
    try {
      await c.query(`SET session_replication_role = 'replica'`);
      return await c.query(sql, params);
    } finally {
      await c.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      c.release();
    }
  };

  beforeAll(async () => {
    repos = await importRepositories();
    gen = await import('../../services/journal-generator.service.js');
    fx = await createBaseFixtures();
  }, 60_000);

  afterAll(async () => {
    const mine = `SELECT id FROM journal_entries WHERE created_by = $1 OR posted_by = $1`;
    await replica(`DELETE FROM ledger_audit_log WHERE entry_id IN (${mine})`, [fx.userId]).catch(() => undefined);
    await replica(`DELETE FROM journal_entry_lines WHERE journal_entry_id IN (${mine})`, [fx.userId]).catch(() => undefined);
    await replica(`DELETE FROM journal_entries WHERE created_by = $1 OR posted_by = $1`, [fx.userId]).catch(() => undefined);
    await replica(`UPDATE fiscal_periods SET status = 'open' WHERE $1::date BETWEEN start_date AND end_date`, [LOCKED_DAY]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('numérotation : 20 validations simultanées donnent 20 numéros distincts et consécutifs', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => post('2027-02-10', [
      { account_code: '6181', debit: 1 + i, credit: 0, label: 'conc' },
      { account_code: '5161', debit: 0, credit: 1 + i, label: 'conc' },
    ])));
    const numbers = results.map(r => r.entry_number);
    expect(new Set(numbers).size).toBe(20);
    const suffix = numbers.map(n => Number(n.split('-').pop())).sort((a, b) => a - b);
    expect(suffix[suffix.length - 1] - suffix[0]).toBe(19);   // aucun trou dans le lot
    expect(numbers.every(n => /^OD-2027-\d{5}$/.test(n))).toBe(true);
  });

  it('chaîne : une écriture scellée puis altérée est détectée, et l\'est plus une fois rétablie', async () => {
    const e = await post('2027-03-10', [
      { account_code: '6181', debit: 42, credit: 0, label: 'original' },
      { account_code: '5161', debit: 0, credit: 42, label: 'original' },
    ]);
    await p().query(`SELECT fn_ledger_seal()`);
    const problems = async () => (await p().query(`SELECT problem FROM fn_ledger_verify(100000) WHERE entry_id = $1`, [e.id])).rows.map(r => r.problem as string);
    const before = await problems();
    await replica(`UPDATE journal_entry_lines SET label = 'falsifié' WHERE journal_entry_id = $1 AND line_order = 1`, [e.id]);
    const tampered = await problems();
    expect(tampered.length).toBeGreaterThan(before.length);
    await replica(`UPDATE journal_entry_lines SET label = 'original' WHERE journal_entry_id = $1 AND line_order = 1`, [e.id]);
    expect(await problems()).toEqual(before);
  });

  it('verrou de période : une écriture ne s\'insère pas dans une période verrouillée', async () => {
    await p().query(`SELECT fn_ensure_fiscal_period($1::date)`, [LOCKED_DAY]);
    await replica(`UPDATE fiscal_periods SET status = 'locked' WHERE $1::date BETWEEN start_date AND end_date`, [LOCKED_DAY]);
    const journal = (await p().query(`SELECT id FROM journals WHERE code = 'OD'`)).rows[0].id;
    const period = (await p().query(`SELECT id FROM fiscal_periods WHERE $1::date BETWEEN start_date AND end_date`, [LOCKED_DAY])).rows[0].id;
    await expect(p().query(
      `INSERT INTO journal_entries (entry_number, journal_id, entry_date, fiscal_period_id, description, source_kind, status, created_by)
       VALUES ('TEST-LOCK-' || gen_random_uuid()::text, $1, $2, $3, 'doit être refusée', 'manual', 'draft', $4)`,
      [journal, LOCKED_DAY, period, fx.userId])).rejects.toThrow();
    // Une pièce de cette date n'est pas perdue : elle est redatée dans la première période ouverte.
    const r = await post(LOCKED_DAY, [
      { account_code: '6181', debit: 5, credit: 0, label: 'redatée' },
      { account_code: '5161', debit: 0, credit: 5, label: 'redatée' },
    ]);
    const d = (await p().query(`SELECT entry_date::text AS d FROM journal_entries WHERE id = $1`, [r.id])).rows[0].d;
    expect(d > LOCKED_DAY).toBe(true);
  });

  it(`invariant : après 60 écritures et 10 extournes tirées au hasard (graine ${SEED}), tout reste équilibré`, async () => {
    const rnd = mulberry32(SEED);
    const accounts = ['6181', '6125', '6171', '7111', '5161', '5141'];
    const ids: string[] = [];
    for (let i = 0; i < 60; i++) {
      const month = 1 + Math.floor(rnd() * 6);
      const day = 1 + Math.floor(rnd() * 27);
      const n = 2 + Math.floor(rnd() * 3);                                   // 2 à 4 lignes
      const lines: L[] = [];
      let total = 0;
      for (let k = 0; k < n - 1; k++) {
        const amount = Math.round((1 + rnd() * 999) * 100) / 100;
        total = Math.round((total + amount) * 100) / 100;
        lines.push({ account_code: accounts[Math.floor(rnd() * accounts.length)], debit: amount, credit: 0, label: `rnd ${i}` });
      }
      lines.push({ account_code: accounts[Math.floor(rnd() * accounts.length)], debit: 0, credit: total, label: `rnd ${i}` });
      ids.push((await post(`2027-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, lines)).id);
    }
    for (let i = 0; i < 10; i++) {
      const c = await repos.db.getClient();
      try {
        await c.query('BEGIN');
        await gen.extourneEntryById(c, ids[Math.floor(rnd() * ids.length)], undefined, { userId: fx.userId });
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');   // une même écriture tirée deux fois n'est extournable qu'une fois
        expect(String((e as Error).message)).toMatch(/extourn|déjà|already|posted/i);
      } finally { c.release(); }
    }
    const unbalanced = (await p().query(
      `SELECT je.entry_number FROM journal_entries je JOIN journal_entry_lines l ON l.journal_entry_id = je.id
        WHERE je.created_by = $1 GROUP BY je.id HAVING sum(l.debit) <> sum(l.credit)`, [fx.userId])).rows;
    expect(unbalanced).toEqual([]);
    const total = (await p().query(`SELECT sum(debit) - sum(credit) AS diff FROM journal_entry_lines`)).rows[0].diff;
    expect(Number(total)).toBe(0);
    // Chaque écriture extournée est liée à son extourne, et inversement.
    const orphans = (await p().query(
      `SELECT e.entry_number FROM journal_entries e
        WHERE e.created_by = $1 AND e.status = 'reversed' AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_entry_id = e.id)`, [fx.userId])).rows;
    expect(orphans).toEqual([]);
  }, 120_000);
});
