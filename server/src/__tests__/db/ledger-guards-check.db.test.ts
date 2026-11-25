/**
 * Plan d'action compta, étape 10 (audit C-08) : la surveillance planifiée relève un trigger de
 * garde désactivé, trace son résultat et bloque la clôture quand elle trouve une anomalie.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories } from './helpers.js';

describe.skipIf(!hasTestDb)('Surveillance des protections du grand livre', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let integrity: typeof import('../../repositories/ledger-integrity.repository.js').ledgerIntegrityRepository;
  let scheduler: typeof import('../../services/scheduler.js');
  const p = () => testPool();
  let maxAuditId = '0';

  beforeAll(async () => {
    repos = await importRepositories();
    maxAuditId = String((await p().query(`SELECT COALESCE(max(id), 0) AS m FROM ledger_audit_log`)).rows[0].m);
    integrity = (await import('../../repositories/ledger-integrity.repository.js')).ledgerIntegrityRepository;
    scheduler = await import('../../services/scheduler.js');
  }, 60_000);

  afterAll(async () => {
    // Les résultats de surveillance posés par ce test ne doivent pas bloquer la clôture des autres
    // tests de la base partagée (journal d'audit en ajout seul : suppression en mode réplication).
    const c = await p().connect();
    try {
      await c.query(`SET session_replication_role = 'replica'`);
      await c.query(`DELETE FROM ledger_audit_log WHERE event IN ('guards_check', 'verify') AND id > $1`, [maxAuditId]).catch(() => undefined);
    } finally {
      await c.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      c.release();
    }
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('les sept triggers de garde sont tous actifs sur une base saine', async () => {
    const rows = (await p().query(`SELECT * FROM fn_ledger_guards_status()`)).rows as Array<{ trigger_name: string; enabled: boolean }>;
    expect(rows).toHaveLength(7);
    expect(rows.filter(r => !r.enabled).map(r => r.trigger_name)).toEqual([]);
  });

  it('un trigger désactivé est signalé (dans une transaction annulée : la base n\'est pas touchée)', async () => {
    const c = await p().connect();
    try {
      await c.query('BEGIN');
      await c.query(`ALTER TABLE journal_entry_lines DISABLE TRIGGER trg_journal_line_guard`);
      const rows = (await c.query(`SELECT * FROM fn_ledger_guards_status() WHERE NOT enabled`)).rows;
      expect(rows.map(r => r.trigger_name)).toEqual(['trg_journal_line_guard']);
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
    }
    expect((await p().query(`SELECT 1 FROM fn_ledger_guards_status() WHERE NOT enabled`)).rows).toHaveLength(0);
  });

  it('la tâche planifiée trace son résultat, et la clôture suit ce résultat', async () => {
    expect(scheduler.JOBS.ledger_guards_check).toBeTypeOf('function');
    const r = await integrity.checkGuards();
    expect(r.message).toBeTruthy();
    const last = (await p().query(`SELECT details FROM ledger_audit_log WHERE event = 'guards_check' ORDER BY id DESC LIMIT 1`)).rows[0].details;
    expect(last.disabled).toEqual([]);
    expect(last.replication_role_forced).toBe(false);
    expect(last.session_replication_role).toBe('origin');

    // Contrôle de clôture : présent et bloquant si, et seulement si, la dernière surveillance a échoué.
    await p().query(`SELECT fn_ensure_fiscal_period($1::date)`, ['2027-06-15']);
    const period = (await p().query(`SELECT id FROM fiscal_periods WHERE '2027-06-15'::date BETWEEN start_date AND end_date`)).rows[0].id;
    const row = (await p().query(`SELECT * FROM fn_close_checklist($1) WHERE code = 'ledger_guards'`, [period])).rows[0];
    if (last.ok) expect(row).toBeUndefined();
    else expect(row).toMatchObject({ blocking: true });
  });
});
