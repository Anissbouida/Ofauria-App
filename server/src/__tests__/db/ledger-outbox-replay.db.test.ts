/**
 * Plan d'action compta, étape 5 (audit C-07) : la file d'écritures en attente est rejouée par une
 * tâche planifiée, avec un délai croissant entre essais, une cause classée et UNE notification.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories } from './helpers.js';

describe.skipIf(!hasTestDb)('File d\'écritures : rejeu planifié, délai croissant, cause classée', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let posting: typeof import('../../services/ledger-posting.service.js');
  let scheduler: typeof import('../../services/scheduler.js');
  let userId = '';
  const ids: string[] = [];
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    posting = await import('../../services/ledger-posting.service.js');
    scheduler = await import('../../services/scheduler.js');
    userId = (await p().query(`SELECT id FROM users WHERE is_system LIMIT 1`)).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    if (ids.length) await p().query(`DELETE FROM ledger_outbox WHERE id = ANY($1::uuid[])`, [ids]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  const row = async (kind: string, attempts: number, nextAttempt: string | null) => {
    const r = await p().query(
      `INSERT INTO ledger_outbox (source_kind, source_id, status, attempts, last_error, next_attempt_at)
       VALUES ($1, gen_random_uuid(), 'pending', $2, 'échec de test', ${nextAttempt ?? 'NULL'}) RETURNING id`, [kind, attempts]);
    ids.push(r.rows[0].id);
    return r.rows[0].id as string;
  };
  const get = async (id: string) => (await p().query(`SELECT * FROM ledger_outbox WHERE id = $1`, [id])).rows[0];

  it('classifie la cause d\'un échec', () => {
    const c = posting.classifyPostingError;
    expect(c(new Error('Catégorie « Entretien » sans compte comptable (ni chez ses parents) : renseignez-le'))).toBe('MISSING_ACCOUNT');
    expect(c(new Error('Paramétrage comptable manquant pour l\'événement « grir »'))).toBe('MISSING_ACCOUNT');
    expect(c(new Error('Aucune période ouverte après 2026-01-01'))).toBe('PERIOD_CLOSED');
    expect(c(new Error('Prix de la ligne de BC absent'))).toBe('MISSING_PRICE');
    expect(c(new Error('Auxiliaire manquant pour le tiers'))).toBe('MISSING_AUXILIARY');
    expect(c(Object.assign(new Error('x'), { code: 'UNSUPPORTED_PAYMENT_METHOD' }))).toBe('UNSUPPORTED_PAYMENT_METHOD');
    expect(c(new Error('autre chose'))).toBe('OTHER');
  });

  it('le rejeu planifié ne touche que les pièces dont le délai est échu', async () => {
    const due = await row('closure_diff', 1, null);                       // aucun délai : échue
    const later = await row('closure_diff', 1, `now() + interval '1 hour'`); // pas encore
    await posting.replayOutbox(userId, undefined, { onlyDue: true });
    expect((await get(due)).status).toBe('posted');
    expect((await get(later)).status).toBe('pending');
    // Le rejeu manuel (bouton) passe tout, sans attendre le délai.
    await posting.replayOutbox(userId, later);
    expect((await get(later)).status).toBe('posted');
  });

  it('un échec de rejeu allonge le délai (15 min, 1 h, 6 h, 24 h) et classe la cause', async () => {
    const stuck = await row('type_inconnu', 1, null);
    const delays: number[] = [];
    for (let i = 0; i < 4; i++) {
      await posting.replayOutbox(userId, stuck);
      const r = await get(stuck);
      expect(r.status).toBe('pending');
      expect(r.error_code).toBe('OTHER');
      expect(r.last_error).toMatch(/non rejouable/);
      delays.push(Math.round((new Date(r.next_attempt_at).getTime() - Date.now()) / 60_000));
    }
    expect(delays[0]).toBeGreaterThan(50);   // 2e essai : 1 h
    expect(delays[0]).toBeLessThanOrEqual(60);
    expect(delays[1]).toBeGreaterThan(300);  // 3e essai : 6 h
    expect(delays[1]).toBeLessThanOrEqual(360);
    expect(delays[2]).toBeGreaterThan(1300); // 4e essai et suivants : 24 h
    expect(delays[3]).toBeLessThanOrEqual(1440);
  });

  it('la tâche planifiée prévient une seule fois les pièces qui résistent', async () => {
    const stuck = await row('type_inconnu', 2, null);
    const handler = scheduler.JOBS.ledger_outbox_replay;
    expect(handler).toBeTypeOf('function');
    await handler();
    const first = (await get(stuck)).notified_at;
    expect(first).not.toBeNull();
    await p().query(`UPDATE ledger_outbox SET next_attempt_at = NULL WHERE id = $1`, [stuck]);
    await handler();
    expect((await get(stuck)).notified_at).toEqual(first);
  });
});
