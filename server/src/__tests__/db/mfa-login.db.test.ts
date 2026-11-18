/**
 * G6-01 — double authentification à la connexion (mig 577).
 *  - activation : un code faux est refusé, un code juste active et rend 10 codes de secours ;
 *  - connexion : le mot de passe seul ne donne pas de session mais un jeton intermédiaire,
 *    inutilisable comme jeton de session ; code faux refusé ; code juste → session ;
 *  - un code de secours sert une seule fois ;
 *  - rôle soumis (admin) sans double authentification → configuration imposée.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Double authentification (G6-01)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let mfa: typeof import('../../repositories/mfa.repository.js')['mfaRepository'];
  let totp: typeof import('../../services/totp.js');
  let jwtu: typeof import('../../utils/jwt.js');
  let app: express.Express; let fx: Fixtures; let userId: string; let secret: string; let backups: string[];
  const email = `mfa-${RUN}@test.local`.toLowerCase();
  const password = 'Motdepasse-M601!';
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    mfa = (await import('../../repositories/mfa.repository.js')).mfaRepository;
    totp = await import('../../services/totp.js');
    jwtu = await import('../../utils/jwt.js');
    const { authController } = await import('../../controllers/auth.controller.js');
    const { hashPassword } = await import('../../utils/hash.js');
    fx = await createBaseFixtures();
    userId = (await p().query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active) VALUES ($1, $2, 'Mfa', 'Test', 'manager', true) RETURNING id`,
      [email, await hashPassword(password)])).rows[0].id;
    app = express(); app.use(express.json());
    app.post('/login', (req, res) => authController.login(req as never, res));
    app.post('/mfa/verify', (req, res) => authController.mfaVerify(req as never, res));
  }, 60_000);

  afterAll(async () => {
    await p().query(`UPDATE users SET is_active = false, totp_enabled = false, totp_secret_enc = NULL WHERE id = $1`, [userId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('activation : code faux refusé, code juste active + codes de secours', async () => {
    secret = (await mfa.startSetup(userId, email)).secret;
    await expect(mfa.enable(userId, '000000')).rejects.toThrow(/Code invalide/);
    backups = (await mfa.enable(userId, totp.totpAt(secret))).backupCodes;
    expect(backups).toHaveLength(10);
    expect((await mfa.state(userId, ['manager']))).toMatchObject({ enabled: true, required: false, backupCodesLeft: 10 });
  });

  it('connexion en deux temps ; le jeton intermédiaire n\'ouvre pas de session', async () => {
    const first = await request(app).post('/login').send({ email, password });
    expect(first.status).toBe(200);
    expect(first.body.data.mfaRequired).toBe(true);
    expect(first.body.data.token).toBeUndefined();
    const mfaToken = first.body.data.mfaToken as string;
    expect(() => jwtu.verifyToken(mfaToken)).toThrow();
    expect((await request(app).post('/mfa/verify').send({ mfaToken, code: '000000' })).status).toBe(401);
    const ok = await request(app).post('/mfa/verify').send({ mfaToken, code: totp.totpAt(secret) });
    expect(ok.status).toBe(200);
    expect(jwtu.verifyToken(ok.body.data.token).userId).toBe(userId);
  });

  it('code de secours à usage unique ; rôle soumis sans double authentification', async () => {
    expect((await mfa.verify(userId, backups[0])).ok).toBe(true);
    expect((await mfa.verify(userId, backups[0])).ok).toBe(false);
    await mfa.disable(userId);
    expect(await mfa.state(userId, ['admin'])).toMatchObject({ enabled: false, required: true });
  });
});
