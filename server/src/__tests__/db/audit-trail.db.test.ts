/**
 * G6-07 — piste d'audit générique (mig 578).
 *  - une modification n'écrit que les champs changés (ancienne / nouvelle valeur) et l'auteur
 *    (app.user_id) ; une modification sans changement réel n'écrit rien ;
 *  - une colonne sensible est masquée ; une suppression garde l'image de la ligne ;
 *  - la piste est en ajout seul ; les tables exclues (compteurs de stock) ne sont pas suivies.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Piste d\'audit (G6-07)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let at: typeof import('../../repositories/audit-trail.repository.js')['auditTrailRepository'];
  let fx: Fixtures; let ing: string; let userId: string;
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    at = (await import('../../repositories/audit-trail.repository.js')).auditTrailRepository;
    fx = await createBaseFixtures();
    ing = await createIngredient(fx, { name: 'Sel G607', unit: 'kg', unitCost: 2 });
    userId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role, is_active) VALUES ($1, 'x', 'Audit', 'Test', 'manager', true) RETURNING id`, [`audit-${RUN}@test.local`.toLowerCase()])).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await p().query(`UPDATE users SET is_active = false WHERE id = $1`, [userId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('modification : champs changés et auteur ; sans changement réel, rien', async () => {
    const c = await repos.db.getClient();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      await c.query(`UPDATE ingredients SET unit_cost = 2.5, name = name WHERE id = $1`, [ing]);
      await c.query('COMMIT');
    } finally { c.release(); }
    await p().query(`UPDATE ingredients SET name = name WHERE id = $1`, [ing]);
    const h = await at.history('ingredients', ing);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ action: 'U', actor_name: 'Audit Test' });
    expect(Object.keys(h[0].changed)).toEqual(['unit_cost']);
    expect(h[0].changed.unit_cost.map(Number)).toEqual([2, 2.5]);
  });

  it('colonne sensible masquée, suppression gardée, ajout seul, tables exclues', async () => {
    await p().query(`UPDATE users SET password_hash = 'y' WHERE id = $1`, [userId]);
    const u = await at.history('users', userId);
    expect(u[0].changed.password_hash).toEqual(['***', '***']);
    await expect(p().query(`DELETE FROM audit_trail WHERE record_id = $1`, [userId])).rejects.toThrow(/ajout seul/);
    expect(await at.isTracked('ingredients')).toBe(true);
    expect(await at.isTracked('inventory')).toBe(false);
    expect(await at.isTracked('audit_trail')).toBe(false);
    const tmp = (await p().query(`INSERT INTO ingredients (name, unit, unit_cost, category) VALUES ($1, 'kg', 1, 'Test') RETURNING id`, [`Temp G607 ${RUN}`])).rows[0].id;
    await p().query(`DELETE FROM ingredients WHERE id = $1`, [tmp]);
    const d = await at.history('ingredients', tmp);
    expect(d[0].action).toBe('D');
    expect(d[0].changed._deleted.name).toBe(`Temp G607 ${RUN}`);
  });
});
