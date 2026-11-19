/**
 * Plan pilote, étape 3 — écritures sur plusieurs tables en une seule transaction.
 * Une erreur sur la seconde écriture (historique de la marge) annule la première (taux de la
 * société) : avant l'enveloppe withTransaction, le taux restait modifié sans trace.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Transactions critiques (plan pilote, étape 3)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let mk: typeof import('../../repositories/production-markup.repository.js')['productionMarkupRepository'];
  let fx: Fixtures; let before: string | null = null;
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    mk = (await import('../../repositories/production-markup.repository.js')).productionMarkupRepository;
    fx = await createBaseFixtures();
    before = (await p().query(`SELECT production_markup_percent::text AS v FROM company_settings WHERE id = 1`)).rows[0]?.v ?? null;
  }, 60_000);

  afterAll(async () => {
    await p().query(`DROP TRIGGER IF EXISTS trg_test_block_markup ON production_markup_history`).catch(() => undefined);
    await p().query(`DROP FUNCTION IF EXISTS public.fn_test_block_markup()`).catch(() => undefined);
    await p().query(`UPDATE company_settings SET production_markup_percent = $1::numeric WHERE id = 1`, [before]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('marge de production : historique en échec → taux inchangé', async () => {
    await p().query(`CREATE FUNCTION public.fn_test_block_markup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'blocage test'; END $$`);
    await p().query(`CREATE TRIGGER trg_test_block_markup BEFORE INSERT ON production_markup_history FOR EACH ROW EXECUTE FUNCTION public.fn_test_block_markup()`);
    const target = before === '37.5' ? 41.25 : 37.5;
    try {
      await expect(mk.setGlobal(target, fx.userId)).rejects.toThrow(/blocage test/);
    } finally {
      await p().query(`DROP TRIGGER IF EXISTS trg_test_block_markup ON production_markup_history`);
      await p().query(`DROP FUNCTION IF EXISTS public.fn_test_block_markup()`);
    }
    const after = (await p().query(`SELECT production_markup_percent::text AS v FROM company_settings WHERE id = 1`)).rows[0]?.v ?? null;
    expect(after).toBe(before);
  });
});
