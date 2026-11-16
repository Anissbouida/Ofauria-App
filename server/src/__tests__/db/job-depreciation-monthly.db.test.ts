/**
 * G1-07 — tâche planifiée « dotations aux amortissements ».
 * Une immobilisation acquise en janvier de l'exercice du mois écoulé reçoit une dotation
 * par mois jusqu'au mois écoulé ; relancer la tâche ne crée rien de plus.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Tâche planifiée : dotations aux amortissements (G1-07)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let scheduler: typeof import('../../services/scheduler.js');
  let assetId: string;
  let year: number, month: number;
  const p = () => testPool();
  const entries = async () => (await p().query(
    `SELECT period_month, amount::float8 AS amount, journal_entry_id FROM depreciation_entries
      WHERE fixed_asset_id = $1 AND fiscal_year = $2 ORDER BY period_month`, [assetId, year])).rows;

  beforeAll(async () => {
    repos = await importRepositories();
    scheduler = await import('../../services/scheduler.js');
    const svc = await import('../../services/depreciation.service.js');
    const prev = (await p().query(
      `SELECT EXTRACT(YEAR FROM d)::int AS y, EXTRACT(MONTH FROM d)::int AS m
         FROM (SELECT (date_trunc('month', now() AT TIME ZONE 'Africa/Casablanca') - interval '1 day')::date AS d) x`)).rows[0];
    year = prev.y; month = prev.m;
    const admin = (await p().query(`SELECT id FROM users WHERE role = 'admin' AND NOT is_system ORDER BY created_at LIMIT 1`)).rows[0].id;
    const acc: Record<string, string> = {};
    for (const r of (await p().query(`SELECT id, code FROM accounts WHERE code IN ('2332', '2833', '6191')`)).rows) acc[r.code] = r.id;
    const a = await svc.fixedAssetRepository.create({
      label: `Four G107 ${RUN}`, assetAccountId: acc['2332'], depreciationAccountId: acc['2833'], expenseAccountId: acc['6191'],
      acquisitionDate: `${year}-01-10`, acquisitionCost: 12000, durationYears: 5, createdBy: admin,
    });
    assetId = a.id;
  }, 60_000);

  afterAll(async () => {
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('la tâche est enregistrée, désactivée à la livraison', async () => {
    const job = (await p().query(`SELECT enabled, interval_minutes, domain FROM scheduled_jobs WHERE key = 'depreciation_monthly'`)).rows[0];
    expect(job).toEqual({ enabled: false, interval_minutes: 1440, domain: 'accounting' });
  });

  it('une dotation de 200 DH par mois, de janvier au mois écoulé, chacune avec son écriture', async () => {
    const run = await scheduler.runJob('depreciation_monthly', 'manual');
    expect(run.status).toBe('ok');
    const rows = await entries();
    expect(rows.map(r => r.period_month)).toEqual(Array.from({ length: month }, (_, i) => i + 1));
    expect(rows.every(r => r.amount === 200 && r.journal_entry_id)).toBe(true);
  }, 120_000);

  it('relancer la tâche ne crée aucune dotation de plus', async () => {
    const before = (await p().query(`SELECT count(*)::int AS n FROM depreciation_entries WHERE fiscal_year = $1`, [year])).rows[0].n;
    const run = await scheduler.runJob('depreciation_monthly', 'manual');
    expect(run).toMatchObject({ status: 'ok', items: 0 });
    expect(run.message).toMatch(/à jour/);
    expect((await p().query(`SELECT count(*)::int AS n FROM depreciation_entries WHERE fiscal_year = $1`, [year])).rows[0].n).toBe(before);
    expect(await entries()).toHaveLength(month);
  }, 120_000);
});
