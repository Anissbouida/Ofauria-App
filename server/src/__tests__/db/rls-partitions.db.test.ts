/**
 * Lot Bonus 16 (mig 436) — intégration base migrée.
 *
 * RLS : la connexion de test est superutilisateur (qui ignore toute politique) ;
 * le filtrage se vérifie donc sous un rôle sans privilège (kalum_rls_probe,
 * NOSUPERUSER NOBYPASSRLS), comme le rôle applicatif kalum_app du script L0.
 * Deux magasins créés pour le test, une écriture chacun.
 *
 * Partitions : le journal d'audit range chaque trace dans la partition de son
 * exercice ; l'exercice 2099 sert de témoin pour la partition par défaut.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('RLS par établissement et partitions d\'exercice', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let database: typeof import('../../config/database.js');
  const ids: Record<string, string> = {};
  const p = () => testPool();

  /** Exécute `fn` sous le rôle témoin, avec ou sans périmètre magasin. */
  const asProbe = async <T>(scope: string | null, fn: (q: (sql: string, args?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>) => {
    const c = await p().connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE kalum_rls_probe');
      if (scope) await c.query(`SELECT set_config('app.store_scope', $1, true)`, [scope]);
      return await fn((sql, args) => c.query(sql, args));
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
    }
  };

  beforeAll(async () => {
    repos = await importRepositories();
    database = await import('../../config/database.js');
    const manual = (await import('../../repositories/manual-entry.repository.js')).manualEntryRepository;
    await p().query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kalum_rls_probe') THEN
        CREATE ROLE kalum_rls_probe NOLOGIN NOSUPERUSER NOBYPASSRLS;
      END IF; END $$`);
    await p().query(`GRANT USAGE ON SCHEMA public TO kalum_rls_probe`);
    await p().query(`GRANT SELECT, INSERT ON journal_entries, journal_entry_lines, invoices, payments, bill_remittances, treasury_accounts TO kalum_rls_probe`);
    const userId = (await p().query(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`)).rows[0].id;
    for (const k of ['A', 'B']) ids[k] = (await p().query(`INSERT INTO stores (name, city) VALUES ($1, 'Test') RETURNING id`, [`RLS ${k} ${RUN}`])).rows[0].id;
    const acc = async (code: string) => (await p().query(`SELECT id FROM accounts WHERE code = $1`, [code])).rows[0].id as string;
    const [cash, sales] = [await acc('5161'), await acc('7111')];
    for (const k of ['A', 'B']) {
      await manual.createAndPost({ journalCode: 'OD', date: '2027-02-12', description: `RLS ${k} ${RUN}`, lines: [
        { accountId: cash, debit: 100, credit: 0 }, { accountId: sales, debit: 0, credit: 100 },
      ] }, { userId, storeId: ids[k] });
    }
    ids.bank = (await p().query(`SELECT id FROM treasury_accounts WHERE kind = 'bank' ORDER BY is_default DESC LIMIT 1`)).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('le rôle témoin ne voit que son établissement (et les écritures communes) quand le périmètre est déclaré', async () => {
    const mine = `SELECT je.description, count(jel.id)::int AS lines FROM journal_entries je
                    LEFT JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
                   WHERE je.description LIKE $1 GROUP BY 1 ORDER BY 1`;
    const all = await asProbe(null, q => q(mine, [`RLS _ ${RUN}`]));
    expect(all.rows).toEqual([{ description: `RLS A ${RUN}`, lines: 2 }, { description: `RLS B ${RUN}`, lines: 2 }]);
    const a = await asProbe(ids.A, q => q(mine, [`RLS _ ${RUN}`]));
    expect(a.rows).toEqual([{ description: `RLS A ${RUN}`, lines: 2 }]);
    // Les lignes suivent leur en-tête, même interrogées seules.
    const linesB = await asProbe(ids.A, q => q(
      `SELECT count(*)::int AS n FROM journal_entry_lines WHERE journal_entry_id = (SELECT id FROM journal_entries WHERE description = $1)`, [`RLS B ${RUN}`]));
    expect(linesB.rows[0].n).toBe(0);
    const linesBDirect = await asProbe(ids.A, async q => {
      const id = (await p().query(`SELECT id FROM journal_entries WHERE description = $1`, [`RLS B ${RUN}`])).rows[0].id;
      return q(`SELECT count(*)::int AS n FROM journal_entry_lines WHERE journal_entry_id = $1`, [id]);
    });
    expect(linesBDirect.rows[0].n).toBe(0);
  });

  it('écriture refusée hors de son établissement (WITH CHECK)', async () => {
    const insert = (store: string, n: string) => asProbe(ids.A, q => q(
      `INSERT INTO bill_remittances (remittance_number, kind, treasury_account_id, remittance_date, store_id, gross_amount, net_amount)
       VALUES ($1, 'collection', $2, '2027-02-12', $3, 10, 10) RETURNING id`, [n, ids.bank, store]));
    await expect(insert(ids.B, `RLS-B-${RUN}`.slice(0, 20))).rejects.toThrow(/row-level security/);
    const ok = await insert(ids.A, `RLS-A-${RUN}`.slice(0, 20));
    expect(ok.rows).toHaveLength(1);   // annulé par le ROLLBACK de asProbe
  });

  it('runWithStoreScope pose le périmètre sur les connexions empruntées puis le remet à zéro', async () => {
    const read = async () => (await database.db.query(`SELECT current_setting('app.store_scope', true) AS s`)).rows[0].s as string | null;
    expect(await database.runWithStoreScope(ids.A, read)).toBe(ids.A);
    const viaClient = await database.runWithStoreScope(ids.B, async () => {
      const c = await database.db.getClient();
      try { return (await c.query(`SELECT current_setting('app.store_scope', true) AS s`)).rows[0].s; } finally { c.release(); }
    });
    expect(viaClient).toBe(ids.B);
    // Hors périmètre : aucune connexion du pool ne garde la valeur.
    const leftovers = await Promise.all(Array.from({ length: 6 }, () => read()));
    expect(leftovers.every(s => !s)).toBe(true);
    expect(database.currentStoreScope()).toBeNull();
  });

  it('journal d\'audit partitionné par exercice, en ajout seul, partition par défaut protégée', async () => {
    const parts = (await p().query(`SELECT inhrelid::regclass::text AS t FROM pg_inherits WHERE inhparent = 'ledger_audit_log'::regclass`)).rows.map(r => r.t);
    expect(parts).toContain('ledger_audit_log_default');
    expect((await p().query(`SELECT fn_ensure_audit_partition(2031) AS t`)).rows[0].t).toBe('ledger_audit_log_y2031');
    expect((await p().query(`SELECT fn_ensure_audit_partition(2031) AS t`)).rows[0].t).toBe('ledger_audit_log_y2031');   // idempotent
    const row = (await p().query(
      `INSERT INTO ledger_audit_log (at, event, details) VALUES ('2031-06-15 10:00+01', 'verify', $1) RETURNING id, tableoid::regclass::text AS part`,
      [JSON.stringify({ test: RUN })])).rows[0];
    expect(row.part).toBe('ledger_audit_log_y2031');
    // Borne : 31/12 23:30 à Casablanca appartient encore à l'exercice.
    const edge = (await p().query(
      `INSERT INTO ledger_audit_log (at, event, details) VALUES (make_timestamptz(2031, 12, 31, 23, 30, 0, 'Africa/Casablanca'), 'verify', '{}') RETURNING tableoid::regclass::text AS part`)).rows[0];
    expect(edge.part).toBe('ledger_audit_log_y2031');
    await expect(p().query(`UPDATE ledger_audit_log SET event = 'seal' WHERE id = $1`, [row.id])).rejects.toThrow(/ajout seul/);
    await expect(p().query(`DELETE FROM ledger_audit_log WHERE id = $1`, [row.id])).rejects.toThrow(/ajout seul/);
    const plan = (await p().query(`EXPLAIN SELECT count(*) FROM ledger_audit_log WHERE at >= '2031-03-01' AND at < '2031-04-01'`)).rows.map(r => r['QUERY PLAN']).join('\n');
    expect(plan).toContain('ledger_audit_log_y2031');
    expect(plan).not.toContain('ledger_audit_log_default');
    // Exercice sans partition : la trace va dans la partition par défaut, qui bloque ensuite la création.
    await p().query(`INSERT INTO ledger_audit_log (at, event, details) VALUES ('2099-05-01 12:00+00', 'verify', '{}')`);
    await expect(p().query(`SELECT fn_ensure_audit_partition(2099)`)).rejects.toThrow(/partition par défaut/);
  });
});
