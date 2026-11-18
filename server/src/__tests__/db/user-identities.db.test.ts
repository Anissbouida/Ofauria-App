/**
 * G6-02 — rattachement d'une identité externe (mig 579).
 *  - première connexion : rattachée au compte actif de même e-mail (casse ignorée) ;
 *  - connexion suivante : retrouvée par fournisseur + sujet, même si l'e-mail change ;
 *  - e-mail inconnu : aucun compte créé ; compte désactivé : refusé.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Identités externes (G6-02)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let idr: typeof import('../../repositories/user-identity.repository.js')['userIdentityRepository'];
  let fx: Fixtures; let userId: string;
  const email = `sso-${RUN}@exemple.ma`.toLowerCase();
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    idr = (await import('../../repositories/user-identity.repository.js')).userIdentityRepository;
    fx = await createBaseFixtures();
    userId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role, is_active) VALUES ($1, 'x', 'Sso', 'Test', 'manager', true) RETURNING id`, [email])).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await p().query(`UPDATE users SET is_active = false WHERE id = $1`, [userId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('rattachement par e-mail puis par sujet ; inconnu et désactivé refusés', async () => {
    const sub = `g-${RUN}`;
    expect((await idr.resolve('google', sub, email.toUpperCase()))?.id).toBe(userId);
    expect((await idr.resolve('google', sub, `autre-${RUN}@exemple.ma`))?.id).toBe(userId);
    expect(await idr.resolve('google', `inconnu-${RUN}`, `personne-${RUN}@exemple.ma`)).toBeNull();
    expect((await p().query(`SELECT count(*)::int AS n FROM users WHERE email = $1`, [`personne-${RUN}@exemple.ma`])).rows[0].n).toBe(0);
    await p().query(`UPDATE users SET is_active = false WHERE id = $1`, [userId]);
    expect(await idr.resolve('google', sub, email)).toBeNull();
  });
});
