/**
 * Plan d'action compta, étape 23 (audit C-09) : le paramétrage qui décide des comptes et des paiements
 * (journaux, profils de comptabilisation, règles bancaires, comptes de trésorerie, catégories de
 * charge) laisse une trace dans le journal d'audit du paramétrage.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool } from './helpers.js';

const TABLES = ['journals', 'posting_profiles', 'bank_rules', 'treasury_accounts', 'expense_categories'];

describe.skipIf(!hasTestDb)('Audit du paramétrage comptable', () => {
  const p = () => testPool();
  let maxId = '0';

  beforeAll(async () => {
    maxId = String((await p().query(`SELECT COALESCE(max(id), 0) AS m FROM config_audit_log`)).rows[0].m);
  });

  afterAll(async () => {
    // Journal d'audit en ajout seul : les traces du test se retirent en mode réplication.
    const c = await p().connect();
    try {
      await c.query(`SET session_replication_role = 'replica'`);
      await c.query(`DELETE FROM config_audit_log WHERE id > $1 AND table_name = ANY($2::text[])`, [maxId, TABLES]).catch(() => undefined);
    } finally {
      await c.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      c.release();
    }
    await closeTestPool();
  });

  it('un trigger d\'audit est posé sur chacune des cinq tables', async () => {
    const rows = (await p().query(`SELECT tgrelid::regclass::text AS t FROM pg_trigger WHERE tgname = ANY($1::text[]) AND NOT tgisinternal`,
      [TABLES.map(t => `${t}_config_audit`)])).rows.map(r => r.t as string).sort();
    expect(rows).toEqual([...TABLES].sort());
  });

  it('changer le compte d\'un profil de comptabilisation laisse une trace avec l\'ancienne et la nouvelle valeur', async () => {
    const profile = (await p().query(`SELECT id, description FROM posting_profiles WHERE event_type = 'loyalty_cost' LIMIT 1`)).rows[0];
    expect(profile).toBeTruthy();
    try {
      await p().query(`UPDATE posting_profiles SET description = $2 WHERE id = $1`, [profile.id, `${profile.description} (modifié par le test)`]);
      const log = (await p().query(
        `SELECT operation, diff FROM config_audit_log WHERE id > $1 AND table_name = 'posting_profiles' AND record_id = $2::text ORDER BY id DESC LIMIT 1`,
        [maxId, profile.id])).rows[0];
      expect(log.operation).toBe('UPDATE');
      expect(log.diff.description.old).toBe(profile.description);
      expect(log.diff.description.new).toContain('modifié par le test');
    } finally {
      await p().query(`UPDATE posting_profiles SET description = $2 WHERE id = $1`, [profile.id, profile.description]);
    }
  });

  it('modifier un journal est tracé aussi', async () => {
    const journal = (await p().query(`SELECT id, label FROM journals WHERE code = 'OD'`)).rows[0];
    try {
      await p().query(`UPDATE journals SET label = $2 WHERE id = $1`, [journal.id, `${journal.label} test`]);
      const n = (await p().query(`SELECT count(*)::int AS n FROM config_audit_log WHERE id > $1 AND table_name = 'journals' AND record_id = $2::text`, [maxId, journal.id])).rows[0].n;
      expect(n).toBeGreaterThanOrEqual(1);
    } finally {
      await p().query(`UPDATE journals SET label = $2 WHERE id = $1`, [journal.id, journal.label]);
    }
  });
});
