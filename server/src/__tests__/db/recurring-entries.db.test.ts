/**
 * G1-09 — écritures récurrentes.
 * Un modèle mensuel dont la première échéance est le 31 août est instancié le 31/08, le
 * 30/09 et le 31/10 (pas de glissement du 31 vers le 30), une écriture par échéance ;
 * relancer ne crée rien ; deux passages simultanés ne doublent rien ; la date de fin
 * arrête les échéances ; retirer la périodicité rend le modèle manuel.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Écritures récurrentes (G1-09)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let tpl: typeof import('../../repositories/journal-template.repository.js')['journalTemplateRepository'];
  let admin: string;
  const acc: Record<string, string> = {};
  const created: string[] = [];
  const p = () => testPool();
  const AS_OF = '2026-11-16';

  const make = async (name: string, extra: Record<string, unknown>) => {
    const out = await tpl.create({
      name: `${name} ${RUN}`, journalCode: 'OD',
      lines: [{ accountId: acc['6191'], side: 'debit', amount: 500 }, { accountId: acc['2833'], side: 'credit', amount: 500 }],
      ...extra,
    }, { userId: admin, storeId: null });
    if ('error' in out) throw new Error(out.error);
    created.push(out.id);
    return out.id as string;
  };
  const entries = async (id: string) => (await p().query(
    `SELECT entry_date::text AS d, description, status FROM journal_entries WHERE source_detail = $1 ORDER BY entry_date`, [`template:${id}`])).rows;
  const state = async (id: string) => (await p().query(
    `SELECT recurrence, next_run_on::text AS next_run_on, last_run_on::text AS last_run_on, run_count FROM journal_entry_templates WHERE id = $1`, [id])).rows[0];

  beforeAll(async () => {
    repos = await importRepositories();
    ({ journalTemplateRepository: tpl } = await import('../../repositories/journal-template.repository.js'));
    admin = (await p().query(`SELECT id FROM users WHERE role = 'admin' AND NOT is_system ORDER BY created_at LIMIT 1`)).rows[0].id;
    for (const r of (await p().query(`SELECT id, code FROM accounts WHERE code IN ('6191', '2833')`)).rows) acc[r.code] = r.id;
  }, 60_000);

  afterAll(async () => {
    await p().query(`UPDATE journal_entry_templates SET is_active = false, recurrence = NULL, recurrence_anchor = NULL, next_run_on = NULL WHERE id = ANY($1)`, [created]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('mensuel depuis le 31 août : trois échéances, datées 31/08, 30/09, 31/10 ; la prochaine est le 30/11', async () => {
    const id = await make('Loyer G109', { recurrence: 'monthly', firstRunOn: '2026-08-31' });
    const r = await tpl.runRecurring(AS_OF, admin);
    expect(r.errors.filter(e => e.includes(RUN))).toEqual([]);
    const e = await entries(id);
    expect(e.map(x => x.d)).toEqual(['2026-08-31', '2026-09-30', '2026-10-31']);
    expect(e.every(x => x.status === 'posted')).toBe(true);
    expect(e[1].description).toContain('30/09/2026');
    expect(await state(id)).toEqual({ recurrence: 'monthly', next_run_on: '2026-11-30', last_run_on: '2026-10-31', run_count: 3 });
    // Relancer : rien de plus.
    await tpl.runRecurring(AS_OF, admin);
    expect(await entries(id)).toHaveLength(3);
  }, 120_000);

  it('deux passages simultanés : une seule écriture par échéance', async () => {
    const id = await make('Abonnement G109', { recurrence: 'quarterly', firstRunOn: '2026-04-15' });
    await Promise.all([tpl.runRecurring(AS_OF, admin), tpl.runRecurring(AS_OF, admin)]);
    expect((await entries(id)).map(x => x.d)).toEqual(['2026-04-15', '2026-07-15', '2026-10-15']);
    expect((await state(id)).next_run_on).toBe('2027-01-15');
  }, 120_000);

  it('la date de fin arrête les échéances', async () => {
    const id = await make('Leasing G109', { recurrence: 'monthly', firstRunOn: '2026-08-10', endOn: '2026-09-30' });
    await tpl.runRecurring(AS_OF, admin);
    expect((await entries(id)).map(x => x.d)).toEqual(['2026-08-10', '2026-09-10']);
  }, 120_000);

  it('périodicité : première échéance obligatoire ; retirée, le modèle redevient manuel', async () => {
    expect(await tpl.create({ name: 'x', lines: [{ accountId: acc['6191'], side: 'debit', amount: 1 }, { accountId: acc['2833'], side: 'credit', amount: 1 }],
      recurrence: 'monthly' }, { userId: admin, storeId: null })).toEqual({ error: 'Indiquez la date de la première échéance' });
    const id = await make('Manuel G109', { recurrence: 'yearly', firstRunOn: '2030-01-01' });
    const lines = [{ accountId: acc['6191'], side: 'debit' as const, amount: 500 }, { accountId: acc['2833'], side: 'credit' as const, amount: 500 }];
    await tpl.update(id, { name: `Manuel G109 ${RUN}`, lines, recurrence: null });
    expect(await state(id)).toMatchObject({ recurrence: null, next_run_on: null });
    // Absente de la demande : la périodicité n'est pas touchée.
    const kept = await make('Gardé G109', { recurrence: 'yearly', firstRunOn: '2030-01-01' });
    await tpl.update(kept, { name: `Gardé G109 ${RUN}`, lines });
    expect(await state(kept)).toMatchObject({ recurrence: 'yearly', next_run_on: '2030-01-01' });
  });

  it('la tâche planifiée est enregistrée, active, et passe sans erreur', async () => {
    const scheduler = await import('../../services/scheduler.js');
    expect((await p().query(`SELECT enabled, interval_minutes, domain FROM scheduled_jobs WHERE key = 'recurring_entries'`)).rows[0])
      .toEqual({ enabled: true, interval_minutes: 1440, domain: 'accounting' });
    expect((await scheduler.runJob('recurring_entries', 'manual')).status).toBe('ok');
  }, 120_000);
});
