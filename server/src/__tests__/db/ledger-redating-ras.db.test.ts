/**
 * Plan d'action compta :
 *  - étape 8 (audit C-11) : une pièce datée d'une période fermée garde sa date d'origine, le redatage
 *    est tracé, et la politique `ledger.closed_period_policy = refuse` la renvoie en file ;
 *  - étape 6 (audit I-07) : l'état des retenues à la source ne compte que la période demandée.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Redatage tracé et état des retenues à la source', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let gen: typeof import('../../services/journal-generator.service.js');
  let withholding: typeof import('../../repositories/withholding.repository.js').withholdingRepository;
  let fx: Fixtures;
  const sources: string[] = [];
  const p = () => testPool();
  const CLOSED_DAY = '2027-10-10';   // période fermée par le test
  const RAS_MAY = '2027-05-10';
  const RAS_JULY = '2027-07-10';

  const post = async (date: string, debit: string, credit: string, amount: number) => {
    const sourceId = (await p().query(`SELECT gen_random_uuid() AS id`)).rows[0].id as string;
    sources.push(sourceId);
    const c = await repos.db.getClient();
    try {
      await c.query('BEGIN');
      const r = await gen.persistEntry(c, {
        journal_code: 'OD', entry_date: date, description: 'Test redatage', source_kind: 'manual', source_id: sourceId, store_id: null,
        lines: [
          { account_code: debit, debit: amount, credit: 0, label: 'test' },
          { account_code: credit, debit: 0, credit: amount, label: 'test' },
        ],
      }, { userId: fx.userId });
      await c.query('COMMIT');
      return { ...r, sourceId };
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  };
  const setPolicy = (policy: string) =>
    p().query(`UPDATE module_parameters SET value = $1::jsonb WHERE key = 'ledger.closed_period_policy'`, [JSON.stringify({ policy })]);

  beforeAll(async () => {
    repos = await importRepositories();
    gen = await import('../../services/journal-generator.service.js');
    withholding = (await import('../../repositories/withholding.repository.js')).withholdingRepository;
    fx = await createBaseFixtures();
    await p().query(`SELECT fn_ensure_fiscal_period($1::date)`, [CLOSED_DAY]);
    // La clôture applicative est séquentielle (période précédente d'abord) : on ferme ce seul mois
    // par SQL direct, comme le font les autres tests de gel, pour isoler le comportement testé.
    const cc = await p().connect();
    try {
      await cc.query(`SET session_replication_role = 'replica'`);
      await cc.query(`UPDATE fiscal_periods SET status = 'closed' WHERE $1::date BETWEEN start_date AND end_date`, [CLOSED_DAY]);
    } finally {
      await cc.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      cc.release();
    }
  }, 60_000);

  afterAll(async () => {
    const cc = await p().connect();
    try {
      await cc.query(`SET session_replication_role = 'replica'`);
      await cc.query(`DELETE FROM ledger_audit_log WHERE entry_id IN (SELECT id FROM journal_entries WHERE source_id = ANY($1::uuid[]))`, [sources]).catch(() => undefined);
      await cc.query(`DELETE FROM journal_entry_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE source_id = ANY($1::uuid[]))`, [sources]).catch(() => undefined);
      await cc.query(`DELETE FROM journal_entries WHERE source_id = ANY($1::uuid[])`, [sources]).catch(() => undefined);
      await cc.query(`UPDATE fiscal_periods SET status = 'open' WHERE $1::date BETWEEN start_date AND end_date`, [CLOSED_DAY]).catch(() => undefined);
    } finally {
      await cc.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      cc.release();
    }
    await setPolicy('redate').catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  describe('étape 8 : redatage tracé', () => {
    it('pièce d\'une période fermée : écrite au premier jour ouvert, date d\'origine conservée, redatage tracé', async () => {
      await setPolicy('redate');
      const r = await post(CLOSED_DAY, '6181', '5161', 10);
      const e = (await p().query(`SELECT entry_date::text AS entry_date, document_date::text AS document_date FROM journal_entries WHERE id = $1`, [r.id])).rows[0];
      expect(e.document_date).toBe(CLOSED_DAY);
      expect(e.entry_date).toBe('2027-11-01');
      const audit = (await p().query(`SELECT details FROM ledger_audit_log WHERE entry_id = $1 AND event = 'redated'`, [r.id])).rows;
      expect(audit).toHaveLength(1);
      expect(audit[0].details).toMatchObject({ document_date: CLOSED_DAY, entry_date: '2027-11-01' });
    });

    it('pièce d\'une période ouverte : pas de redatage, pas d\'événement', async () => {
      const r = await post(RAS_MAY, '6181', '5161', 10);
      const e = (await p().query(`SELECT entry_date::text AS entry_date, document_date::text AS document_date FROM journal_entries WHERE id = $1`, [r.id])).rows[0];
      expect(e.entry_date).toBe(RAS_MAY);
      expect(e.document_date).toBe(RAS_MAY);
      expect((await p().query(`SELECT 1 FROM ledger_audit_log WHERE entry_id = $1 AND event = 'redated'`, [r.id])).rows).toHaveLength(0);
    });

    it('politique « refuse » : la pièce est refusée avec la cause PERIOD_CLOSED, aucune écriture', async () => {
      await setPolicy('refuse');
      const before = Number((await p().query(`SELECT count(*)::int AS n FROM journal_entries`)).rows[0].n);
      await expect(post(CLOSED_DAY, '6181', '5161', 11)).rejects.toMatchObject({ statusCode: 409, code: 'PERIOD_CLOSED' });
      expect(Number((await p().query(`SELECT count(*)::int AS n FROM journal_entries`)).rows[0].n)).toBe(before);
      await setPolicy('redate');
    });
  });

  describe('étape 6 : état des retenues à la source', () => {
    it('ne compte que la période demandée (mai), pas juillet', async () => {
      const total = async () => {
        const r = await withholding.toRemit({ startDate: '2027-05-01', endDate: '2027-05-31' });
        return Number(r.lines.find((l: { code: string }) => l.code === 'honoraires')?.total_retenu ?? 0);
      };
      const before = await total();
      await post(RAS_MAY, '6181', '44527', 100);
      await post(RAS_JULY, '6181', '44527', 100);
      expect(Math.round((await total() - before) * 100) / 100).toBe(100);
    });

    it('sur une période sans mouvement, l\'état est à zéro', async () => {
      const r = await withholding.toRemit({ startDate: '2027-09-01', endDate: '2027-09-30' });
      expect(r.total_a_reverser).toBe(0);
    });
  });
});
