/**
 * Scénario 1, constat 125 — l'auteur d'une modification est tracé dans la piste d'audit
 * (mig 578) pour toute requête authentifiée : runWithActor (posé par authenticate) marque
 * les connexions d'écriture avec app.user_id, et le remet à zéro au retour au pool.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Piste d\'audit : auteur de la requête (constat 125)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let dbm: typeof import('../../config/database.js');
  let fx: Fixtures;
  let supplierId = '';
  const p = () => testPool();
  const lastActor = async () => (await p().query(
    `SELECT actor_id FROM audit_trail WHERE table_name = 'suppliers' AND record_id = $1 ORDER BY id DESC LIMIT 1`, [supplierId])).rows[0]?.actor_id ?? null;

  beforeAll(async () => {
    repos = await importRepositories();
    dbm = await import('../../config/database.js');
    fx = await createBaseFixtures();
    supplierId = (await p().query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`Audit ${RUN}`])).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM suppliers WHERE id = $1`, [supplierId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('une écriture simple porte l\'auteur', async () => {
    await dbm.runWithActor(fx.userId, () => dbm.db.query(`UPDATE suppliers SET notes = $2 WHERE id = $1`, [supplierId, 'a']));
    expect(await lastActor()).toBe(fx.userId);
  });

  it('une transaction porte l\'auteur', async () => {
    await dbm.runWithActor(fx.userId, () => dbm.withTransaction(async () => {
      await dbm.db.query(`UPDATE suppliers SET notes = $2 WHERE id = $1`, [supplierId, 'b']);
    }));
    expect(await lastActor()).toBe(fx.userId);
  });

  it('hors requête (aucun auteur), rien n\'est attribué ; l\'auteur ne fuit pas d\'une requête à l\'autre', async () => {
    await dbm.db.query(`UPDATE suppliers SET notes = $2 WHERE id = $1`, [supplierId, 'c']);
    expect(await lastActor()).toBeNull();
  });
});
