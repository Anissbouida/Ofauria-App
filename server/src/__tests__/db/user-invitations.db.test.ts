/**
 * Invitation d'un nouveau compte (refonte Utilisateurs, lot 3, mig 700) :
 *  - création avec invite: true → compte actif, mot de passe inconnu, invitation ouverte de 72 h ;
 *  - le lien se lit (prénom, e-mail), s'accepte avec un mot de passe fort, puis ne sert plus ;
 *  - un renvoi annule le lien précédent.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Invitations de comptes (refonte Utilisateurs, lot 3)', () => {
  let app: express.Express;
  const p = () => testPool();
  let actorId = ''; let userId = '';
  let token = '';
  const email = `invite-${RUN}@test.local`.toLowerCase();

  beforeAll(async () => {
    await importRepositories();
    const { userController } = await import('../../controllers/user.controller.js');
    const { invitationController } = await import('../../controllers/invitation.controller.js');
    actorId = (await p().query(
      // Administrateur en base comme dans le jeton : hors administrateur, la création est limitée à
      // ses établissements (administration déléguée, lot 10).
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active) VALUES ($1, 'x', 'Act', 'Eur', 'admin', true) RETURNING id`,
      [`invite-actor-${RUN}@test.local`])).rows[0].id;
    app = express(); app.use(express.json());
    app.use((req, _res, next) => { (req as never as { user: unknown }).user = { userId: actorId, role: 'admin' }; next(); });
    app.post('/users', (req, res) => userController.create(req as never, res));
    app.post('/users/:id/invitations', (req, res) => userController.invite(req as never, res));
    app.get('/auth/invitations/:token', (req, res) => invitationController.peek(req, res));
    app.post('/auth/invitations/:token/accept', (req, res) => invitationController.accept(req, res));
  });

  afterAll(async () => {
    const ids = [actorId, userId].filter(Boolean);
    await p().query(`DELETE FROM user_invitations WHERE user_id = ANY($1::uuid[])`, [ids]);
    await p().query(`DELETE FROM email_outbox WHERE user_id = ANY($1::uuid[])`, [ids]).catch(() => undefined);
    await p().query(`DELETE FROM auth_events WHERE user_id = ANY($1::uuid[]) OR target_user_id = ANY($1::uuid[])`, [ids]);
    await p().query(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [ids]);
    try { await p().query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids]); }
    catch { await p().query(`UPDATE users SET is_active = false WHERE id = ANY($1::uuid[])`, [ids]); }
    await closeTestPool();
  });

  it('refuse un compte sans mot de passe ni invitation', async () => {
    const res = await request(app).post('/users').send({ email: `nopwd-${RUN}@test.local`, firstName: 'Sans', lastName: 'Mdp', roles: ['cashier'] });
    expect(res.status).toBe(400);
  });

  it('crée un compte invité avec une invitation ouverte de 72 h', async () => {
    const res = await request(app).post('/users').set('Origin', 'http://localhost:5173')
      .send({ email, firstName: 'Inès', lastName: 'Invitée', roles: ['cashier'], invite: true });
    expect(res.status).toBe(201);
    userId = res.body.data.id;
    token = res.body.data.invitation.token;
    expect(token.length).toBeGreaterThan(30);
    expect(res.body.data.invitation.path).toBe(`/invitation/${token}`);
    const hours = (new Date(res.body.data.invitation.expiresAt).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(71); expect(hours).toBeLessThanOrEqual(72);
    // Le jeton n'est pas stocké en clair.
    const stored = (await p().query(`SELECT token_hash FROM user_invitations WHERE user_id = $1`, [userId])).rows[0];
    expect(stored.token_hash).not.toBe(token);
  });

  it('lit le lien puis l\'accepte avec un mot de passe fort ; le lien ne sert qu\'une fois', async () => {
    const peek = await request(app).get(`/auth/invitations/${token}`);
    expect(peek.body.data).toEqual(expect.objectContaining({ status: 'valid', email, firstName: 'Inès' }));
    const before = (await p().query(`SELECT password_hash, token_version FROM users WHERE id = $1`, [userId])).rows[0];
    const ok = await request(app).post(`/auth/invitations/${token}/accept`).send({ password: 'Kalum-Invite-2026' });
    expect(ok.status).toBe(200);
    const after = (await p().query(`SELECT password_hash, token_version, must_change_password FROM users WHERE id = $1`, [userId])).rows[0];
    expect(after.password_hash).not.toBe(before.password_hash);
    expect(after.token_version).toBe(before.token_version + 1);
    expect(after.must_change_password).toBe(false);
    const again = await request(app).post(`/auth/invitations/${token}/accept`).send({ password: 'Kalum-Invite-2027' });
    expect(again.status).toBe(410);
    expect((await request(app).get(`/auth/invitations/${token}`)).body.data.status).toBe('used');
  });

  it('un renvoi annule le lien précédent', async () => {
    const first = (await request(app).post(`/users/${userId}/invitations`).send({})).body.data.token as string;
    const second = (await request(app).post(`/users/${userId}/invitations`).send({})).body.data.token as string;
    expect(first).not.toBe(second);
    expect((await request(app).get(`/auth/invitations/${first}`)).body.data.status).toBe('revoked');
    expect((await request(app).get(`/auth/invitations/${second}`)).body.data.status).toBe('valid');
  });

  it('un lien inconnu n\'est pas valable', async () => {
    expect((await request(app).get('/auth/invitations/jeton-inconnu')).body.data.status).toBe('unknown');
  });
});
