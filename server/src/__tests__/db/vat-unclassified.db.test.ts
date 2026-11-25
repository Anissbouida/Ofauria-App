/**
 * Plan d'action compta, étape 3 (audit C-02) : la TVA collectée comptabilisée sur le compte
 * générique 4455 (sans taux) n'est plus perdue. Elle est dans la déclaration, isolée en
 * « sans taux », et la clôture du mois est bloquée tant qu'elle n'est pas classée.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('TVA collectée sans taux : visible dans la déclaration et bloquante à la clôture', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let gen: typeof import('../../services/journal-generator.service.js');
  let tva: typeof import('../../repositories/ledger.repository.js').tvaDeclarationRepository;
  let fx: Fixtures;
  const sources: string[] = [];
  const p = () => testPool();
  const DAY = '2027-08-12';

  beforeAll(async () => {
    repos = await importRepositories();
    gen = await import('../../services/journal-generator.service.js');
    tva = (await import('../../repositories/ledger.repository.js')).tvaDeclarationRepository;
    fx = await createBaseFixtures();
  }, 60_000);

  afterAll(async () => {
    const cc = await p().connect();
    try {
      await cc.query(`SET session_replication_role = 'replica'`);
      await cc.query(`DELETE FROM ledger_audit_log WHERE entry_id IN (SELECT id FROM journal_entries WHERE source_id = ANY($1::uuid[]))`, [sources]).catch(() => undefined);
      await cc.query(`DELETE FROM journal_entry_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE source_id = ANY($1::uuid[]))`, [sources]).catch(() => undefined);
      await cc.query(`DELETE FROM journal_entries WHERE source_id = ANY($1::uuid[])`, [sources]).catch(() => undefined);
    } finally {
      await cc.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      cc.release();
    }
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  const post = async (vatAccount: string, vat: number) => {
    const sourceId = (await p().query(`SELECT gen_random_uuid() AS id`)).rows[0].id as string;
    sources.push(sourceId);
    const c = await repos.db.getClient();
    try {
      await c.query('BEGIN');
      await gen.persistEntry(c, {
        journal_code: 'OD', entry_date: DAY, description: 'Test TVA', source_kind: 'manual', source_id: sourceId, store_id: null,
        lines: [
          { account_code: '5161', debit: vat, credit: 0, label: 'test' },
          { account_code: vatAccount, debit: 0, credit: vat, label: 'test' },
        ],
      }, { userId: fx.userId });
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  };

  const checklist = async () => {
    await p().query(`SELECT fn_ensure_fiscal_period($1::date)`, [DAY]);
    const period = (await p().query(`SELECT id FROM fiscal_periods WHERE $1::date BETWEEN start_date AND end_date`, [DAY])).rows[0].id;
    return (await p().query(`SELECT * FROM fn_close_checklist($1)`, [period])).rows as Array<{ code: string; item_count: string; amount: string | null; blocking: boolean }>;
  };

  it('sans mouvement : aucune TVA sans taux, pas de contrôle bloquant', async () => {
    const d = await tva.declaration({ startDate: '2027-08-01', endDate: '2027-08-31' });
    expect(d.unclassified_collected).toBe(0);
    expect((await checklist()).find(c => c.code === 'vat_unclassified')).toBeUndefined();
  });

  it('TVA sur un compte de taux connu (20 %) : classée, pas de contrôle bloquant', async () => {
    await post('44551', 20);
    const d = await tva.declaration({ startDate: '2027-08-01', endDate: '2027-08-31' });
    expect(d.unclassified_collected).toBe(0);
    expect(d.total_collected).toBe(20);
    expect((await checklist()).find(c => c.code === 'vat_unclassified')).toBeUndefined();
  });

  it('TVA sur le compte générique 4455 : dans le total, isolée « sans taux », clôture bloquée', async () => {
    await post('4455', 12.34);
    const d = await tva.declaration({ startDate: '2027-08-01', endDate: '2027-08-31' });
    expect(d.unclassified_collected).toBe(12.34);
    expect(d.total_collected).toBeCloseTo(32.34, 2);
    expect(d.collected.some((r: { code: string }) => r.code === '4455')).toBe(true);
    const check = (await checklist()).find(c => c.code === 'vat_unclassified');
    expect(check).toBeDefined();
    expect(check!.blocking).toBe(true);
    expect(Number(check!.amount)).toBeCloseTo(12.34, 2);
  });
});
