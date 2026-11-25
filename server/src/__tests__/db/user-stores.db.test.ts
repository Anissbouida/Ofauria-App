/**
 * Refonte Utilisateurs, lot 7 (mig 707) — plusieurs établissements par compte :
 *  - la fiche enregistre les établissements et celui par défaut (= users.store_id) ;
 *  - un déclencheur garde user_stores d'accord avec users.store_id ;
 *  - la personne bascule son établissement actif parmi les siens seulement ; le jeton le porte.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Établissements par compte (refonte Utilisateurs, lot 7)', () => {
  let app: express.Express;
  const p = () => testPool();
  const stores: string[] = [];
  const users: string[] = [];
  let actorId = ''; let userId = '';
  let as: 'admin' | 'self' = 'admin';
  let activeStore: string | undefined;

  beforeAll(async () => {
    await importRepositories();
    const { userController } = await import('../../controllers/user.controller.js');
    const { authController } = await import('../../controllers/auth.controller.js');
    for (const n of ['A', 'B', 'C']) {
      stores.push((await p().query(`INSERT INTO stores (name) VALUES ($1) RETURNING id`, [`Étab ${n} ${RUN}`])).rows[0].id);
    }
    const mk = async (tag: string, role: string) => (await p().query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active) VALUES ($1, 'x', $2, 'Test', $3, true) RETURNING id`,
      [`stores-${tag}-${RUN}@test.local`, tag, role])).rows[0].id as string;
    actorId = await mk('actor', 'admin'); userId = await mk('user', 'cashier');
    users.push(actorId, userId);
    app = express(); app.use(express.json());
    app.use((req, _res, next) => {
      (req as never as { user: unknown }).user = as === 'admin'
        ? { userId: actorId, role: 'admin' }
        : { userId, role: 'cashier', storeId: activeStore, jti: randomUUID(), exp: Math.floor(Date.now() / 1000) + 3600 };
      next();
    });
    app.put('/users/:id', (req, res) => userController.update(req as never, res));
    app.get('/auth/stores', (req, res) => authController.myStores(req as never, res));
    app.post('/auth/active-store', (req, res) => authController.setActiveStore(req as never, res));
  });

  afterAll(async () => {
    await p().query(`DELETE FROM user_stores WHERE user_id = ANY($1::uuid[])`, [users]);
    await p().query(`UPDATE users SET store_id = NULL WHERE id = ANY($1::uuid[])`, [users]);
    await p().query(`DELETE FROM user_stores WHERE store_id = ANY($1::uuid[])`, [stores]);
    try { await p().query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]); }
    catch { await p().query(`UPDATE users SET is_active = false WHERE id = ANY($1::uuid[])`, [users]); }
    try { await p().query(`DELETE FROM stores WHERE id = ANY($1::uuid[])`, [stores]); }
    catch { await p().query(`UPDATE stores SET is_active = false WHERE id = ANY($1::uuid[])`, [stores]); }
    await closeTestPool();
  });

  it('enregistre plusieurs établissements et celui par défaut', async () => {
    as = 'admin';
    const before = (await p().query(`SELECT token_version FROM users WHERE id = $1`, [userId])).rows[0].token_version;
    const res = await request(app).put(`/users/${userId}`).send({ storeIds: [stores[0], stores[1]], storeId: stores[1] });
    expect(res.status).toBe(200);
    const rows = (await p().query(`SELECT store_id, is_default FROM user_stores WHERE user_id = $1 ORDER BY is_default DESC`, [userId])).rows;
    expect(rows.map(r => r.store_id).sort()).toEqual([stores[0], stores[1]].sort());
    expect(rows[0]).toEqual({ store_id: stores[1], is_default: true });
    const u = (await p().query(`SELECT store_id, token_version FROM users WHERE id = $1`, [userId])).rows[0];
    expect(u.store_id).toBe(stores[1]);
    expect(u.token_version).toBeGreaterThan(before);
    expect((await request(app).put(`/users/${userId}`).send({ storeIds: [randomUUID()] })).status).toBe(400);
  });

  it('la personne bascule son établissement actif parmi les siens seulement', async () => {
    as = 'self'; activeStore = stores[1];
    const mine = (await request(app).get('/auth/stores')).body.data;
    expect(mine.activeStoreId).toBe(stores[1]);
    expect(mine.stores.map((s: { id: string }) => s.id).sort()).toEqual([stores[0], stores[1]].sort());
    const ok = await request(app).post('/auth/active-store').send({ storeId: stores[0] });
    expect(ok.status).toBe(200);
    const payload = JSON.parse(Buffer.from(ok.body.data.token.split('.')[1], 'base64url').toString());
    expect(payload.storeId).toBe(stores[0]);
    expect((await request(app).post('/auth/active-store').send({ storeId: stores[2] })).status).toBe(403);
    // Identifiant non v4 (établissement d'origine 00000000-…-0001) : accepté par la validation, refusé car non rattaché.
    const { activeStoreSchemaForTest } = await import('../../routes/auth.routes.js');
    expect(activeStoreSchemaForTest.safeParse({ storeId: '00000000-0000-0000-0000-000000000001' }).success).toBe(true);
  });

  it('users.store_id écrit ailleurs reste l\'établissement par défaut', async () => {
    await p().query(`UPDATE users SET store_id = $2 WHERE id = $1`, [userId, stores[2]]);
    const rows = (await p().query(`SELECT store_id FROM user_stores WHERE user_id = $1 AND is_default`, [userId])).rows;
    expect(rows).toEqual([{ store_id: stores[2] }]);
    expect(Number((await p().query(`SELECT count(*) FROM user_stores WHERE user_id = $1`, [userId])).rows[0].count)).toBe(3);
  });
});
