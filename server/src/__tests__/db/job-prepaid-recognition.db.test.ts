/**
 * G1-08 — tâche planifiée « charges constatées d'avance ».
 * Une assurance de 1 200 DH sur les douze mois de l'exercice du mois écoulé est constatée
 * à raison de 100 DH par mois échu ; relancer la tâche ne constate rien de plus.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Tâche planifiée : charges constatées d\'avance (G1-08)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let scheduler: typeof import('../../services/scheduler.js');
  let chargeId: string;
  let year: number, month: number;
  const p = () => testPool();
  const recognitions = async () => (await p().query(
    `SELECT to_char(period_month, 'YYYY-MM') AS m, amount::float8 AS amount FROM prepaid_charge_recognitions
      WHERE prepaid_charge_id = $1 ORDER BY period_month`, [chargeId])).rows;

  beforeAll(async () => {
    repos = await importRepositories();
    scheduler = await import('../../services/scheduler.js');
    const { prepaidChargeRepository } = await import('../../repositories/prepaid-charge.repository.js');
    const prev = (await p().query(
      `SELECT EXTRACT(YEAR FROM d)::int AS y, EXTRACT(MONTH FROM d)::int AS m
         FROM (SELECT (date_trunc('month', now() AT TIME ZONE 'Africa/Casablanca') - interval '1 day')::date AS d) x`)).rows[0];
    year = prev.y; month = prev.m;
    const admin = (await p().query(`SELECT id FROM users WHERE role = 'admin' AND NOT is_system ORDER BY created_at LIMIT 1`)).rows[0].id;
    const account = (await p().query(`SELECT code FROM accounts WHERE account_class = 6 AND code LIKE '613%' ORDER BY code LIMIT 1`)).rows[0]?.code
      ?? (await p().query(`SELECT code FROM accounts WHERE account_class = 6 ORDER BY code LIMIT 1`)).rows[0].code;
    const created = await prepaidChargeRepository.create({
      label: `Assurance G108 ${RUN}`, chargeAccountCode: account, totalAmount: 1200,
      startDate: `${year}-01-01`, endDate: `${year}-12-31`, userId: admin,
    });
    if ('error' in created) throw new Error(created.error);
    chargeId = created.data.id;
  }, 60_000);

  afterAll(async () => {
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('la tâche est enregistrée, désactivée à la livraison', async () => {
    expect((await p().query(`SELECT enabled, interval_minutes, domain FROM scheduled_jobs WHERE key = 'prepaid_recognition'`)).rows[0])
      .toEqual({ enabled: false, interval_minutes: 1440, domain: 'accounting' });
  });

  it('100 DH constatés par mois échu, de janvier au mois écoulé', async () => {
    const run = await scheduler.runJob('prepaid_recognition', 'manual');
    expect(run.status).toBe('ok');
    const rows = await recognitions();
    expect(rows.map(r => r.m)).toEqual(Array.from({ length: month }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`));
    expect(rows.every(r => r.amount === 100)).toBe(true);
  }, 120_000);

  it('relancer la tâche ne constate rien de plus', async () => {
    const run = await scheduler.runJob('prepaid_recognition', 'manual');
    expect(run).toMatchObject({ status: 'ok', items: 0 });
    expect(await recognitions()).toHaveLength(month);
  }, 120_000);
});
