/**
 * Refonte Utilisateurs, lot 8 (mig 708) — politique de sécurité et sessions :
 *  - politique lue/écrite, valeurs hors liste refusées ;
 *  - verrouillage selon le seuil choisi ; mot de passe plus court que la politique refusé ;
 *  - renouvellement : un mot de passe trop ancien impose son changement à la connexion ;
 *  - délai pour configurer la double authentification ;
 *  - chaque connexion ouvre une session, listée puis fermée (jeton révoqué).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Politique de sécurité et sessions (refonte Utilisateurs, lot 8)', () => {
  let app: express.Express;
  const p = () => testPool();
  const users: string[] = [];
  let actorId = ''; let userId = ''; let email = '';
  let previous: unknown = null;
  const PASSWORD = 'Kalum-Test-2026!';
  let policy: typeof import('../../services/security-policy.js');

  beforeAll(async () => {
    await importRepositories();
    const { userController } = await import('../../controllers/user.controller.js');
    const { authController } = await import('../../controllers/auth.controller.js');
    const { hashPassword } = await import('../../utils/hash.js');
    policy = await import('../../services/security-policy.js');
    previous = (await p().query(`SELECT value FROM module_parameters WHERE key = 'security.policy'`)).rows[0]?.value ?? null;
    actorId = (await p().query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active) VALUES ($1, 'x', 'Act', 'Eur', 'admin', true) RETURNING id`,
      [`sec-actor-${RUN}@test.local`])).rows[0].id;
    email = `sec-user-${RUN}@test.local`;
    userId = (await p().query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active) VALUES ($1, $2, 'Sec', 'Test', 'cashier', true) RETURNING id`,
      [email, await hashPassword(PASSWORD)])).rows[0].id;
    users.push(actorId, userId);
    app = express(); app.use(express.json());
    app.post('/auth/login', (req, res) => authController.login(req as never, res));
    app.use((req, _res, next) => { (req as never as { user: unknown }).user = { userId: actorId, role: 'admin' }; next(); });
    app.get('/policy', (req, res) => userController.securityPolicy(req as never, res));
    app.put('/policy', (req, res) => userController.setSecurityPolicy(req as never, res));
    app.put('/users/:id', (req, res) => userController.update(req as never, res));
    app.get('/users/:id/sessions', (req, res) => userController.sessions(req as never, res));
    app.delete('/users/:id/sessions/:jti', (req, res) => userController.closeSession(req as never, res));
  });

  afterAll(async () => {
    if (previous) await p().query(`UPDATE module_parameters SET value = $1 WHERE key = 'security.policy'`, [JSON.stringify(previous)]);
    policy.invalidateSecurityPolicy();
    await p().query(`DELETE FROM user_sessions WHERE user_id = ANY($1::uuid[])`, [users]);
    try { await p().query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]); }
    catch { await p().query(`UPDATE users SET is_active = false WHERE id = ANY($1::uuid[])`, [users]); }
    await closeTestPool();
  });

  const setPolicy = async (body: Record<string, number>) => {
    const r = await request(app).put('/policy').send(body);
    policy.invalidateSecurityPolicy();
    return r;
  };

  it('lit et règle la politique ; refuse une valeur hors liste', async () => {
    const read = await request(app).get('/policy');
    expect(read.body.data.policy).toEqual(expect.objectContaining({ passwordMinLength: 12, lockoutThreshold: 5, idleMinutes: 15 }));
    expect((await setPolicy({ passwordMaxAgeDays: 45 })).status).toBe(400);
    expect((await setPolicy({ passwordMinLength: 8 })).status).toBe(400);
    expect((await setPolicy({ lockoutThreshold: 3, lockoutMinutes: 10, passwordMinLength: 16 })).status).toBe(200);
    expect((await policy.securityPolicy()).lockoutThreshold).toBe(3);
  });

  it('refuse un mot de passe plus court que la politique', async () => {
    const res = await request(app).put(`/users/${userId}`).send({ password: 'Abcdef-12345!' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('16 caractères');
  });

  it('verrouille après le nombre d\'échecs choisi', async () => {
    expect((await request(app).post('/auth/login').send({ email, password: 'mauvais-1' })).status).toBe(401);
    expect((await request(app).post('/auth/login').send({ email, password: 'mauvais-2' })).status).toBe(401);
    expect((await request(app).post('/auth/login').send({ email, password: 'mauvais-3' })).status).toBe(423);
    await p().query(`UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = $1`, [userId]);
  });

  it('impose le changement d\'un mot de passe trop ancien ou trop court, et ouvre une session', async () => {
    await setPolicy({ passwordMinLength: 12, passwordMaxAgeDays: 90 });
    await p().query(`UPDATE users SET password_changed_at = now() - interval '100 days', must_change_password = false WHERE id = $1`, [userId]);
    const res = await request(app).post('/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.user.mustChangePassword).toBe(true);
    expect(res.body.data.user.idleMinutes).toBe(15);
    const sessions = (await request(app).get(`/users/${userId}/sessions`)).body.data;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toEqual(expect.objectContaining({ method: 'password', current: false }));
    const jti = sessions[0].jti as string;
    expect((await request(app).delete(`/users/${userId}/sessions/${jti}`)).status).toBe(200);
    expect((await p().query(`SELECT 1 FROM revoked_tokens WHERE jti = $1`, [jti])).rows).toHaveLength(1);
    expect((await request(app).get(`/users/${userId}/sessions`)).body.data).toHaveLength(0);
    expect((await request(app).delete(`/users/${userId}/sessions/${jti}`)).status).toBe(404);
  });

  it('accorde un délai pour configurer la double authentification', async () => {
    await setPolicy({ passwordMaxAgeDays: 0, mfaGraceDays: 7 });
    await p().query(`UPDATE users SET mfa_required = true, must_change_password = false, mfa_grace_started_at = NULL WHERE id = $1`, [userId]);
    const first = await request(app).post('/auth/login').send({ email, password: PASSWORD });
    expect(first.body.data.user.mfaSetupRequired).toBe(false);
    expect((await p().query(`SELECT mfa_grace_started_at FROM users WHERE id = $1`, [userId])).rows[0].mfa_grace_started_at).not.toBeNull();
    await p().query(`UPDATE users SET mfa_grace_started_at = now() - interval '8 days' WHERE id = $1`, [userId]);
    const late = await request(app).post('/auth/login').send({ email, password: PASSWORD });
    expect(late.body.data.user.mfaSetupRequired).toBe(true);
  });
});
