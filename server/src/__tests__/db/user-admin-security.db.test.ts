/**
 * Administration des comptes par l'administrateur (mig 617) :
 *  - double authentification exigée pour un compte (en plus des rôles) puis réinitialisée ;
 *  - garde-fous : pas d'auto-désactivation, jamais le dernier administrateur actif ;
 *  - suppression définitive seulement sans historique (sinon 409, on désactive) ;
 *  - déverrouillage et fermeture des sessions.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Administration des comptes (mig 617)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let app: express.Express;
  let adminId: string; let otherAdminId: string; let staffId: string; let freshId: string; let histId: string;
  const created: string[] = [];
  let parkedAdmins: string[] = [];
  const p = () => testPool();
  let actor = '';

  const mkUser = async (tag: string, role: string, active = true) => {
    const id = (await p().query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active) VALUES ($1, 'x', 'Adm', $2, $3, $4) RETURNING id`,
      [`adm-${tag}-${RUN}@test.local`, tag, role, active])).rows[0].id as string;
    created.push(id);
    return id;
  };

  beforeAll(async () => {
    repos = await importRepositories();
    const { userController } = await import('../../controllers/user.controller.js');
    // Les autres administrateurs de la base de test sont mis de côté (puis rétablis) pour tester le garde-fou.
    parkedAdmins = (await p().query(
      `UPDATE users SET is_active = false WHERE role = 'admin' AND is_active AND NOT is_system RETURNING id`)).rows.map(r => r.id as string);
    adminId = await mkUser('admin', 'admin');
    otherAdminId = await mkUser('admin2', 'admin', false);
    staffId = await mkUser('staff', 'cashier');
    freshId = await mkUser('fresh', 'cashier');
    histId = await mkUser('hist', 'cashier');
    actor = adminId;
    app = express(); app.use(express.json());
    app.use((req, _res, next) => { (req as never as { user: unknown }).user = { userId: actor, role: 'admin' }; next(); });
    app.put('/users/:id', (req, res) => userController.update(req as never, res));
    app.delete('/users/:id', (req, res) => userController.remove(req as never, res));
    app.delete('/users/:id/permanent', (req, res) => userController.hardDelete(req as never, res));
    app.put('/users/:id/mfa-required', (req, res) => userController.setMfaRequired(req as never, res));
    app.post('/users/:id/mfa-reset', (req, res) => userController.resetMfa(req as never, res));
    app.post('/users/:id/unlock', (req, res) => userController.unlock(req as never, res));
    app.post('/users/:id/revoke-sessions', (req, res) => userController.revokeSessions(req as never, res));
    app.get('/users', (req, res) => userController.list(req as never, res));
  }, 60_000);

  afterAll(async () => {
    if (parkedAdmins.length) await p().query(`UPDATE users SET is_active = true WHERE id = ANY($1)`, [parkedAdmins]).catch(() => undefined);
    if (created.length) {
      await p().query(`DELETE FROM auth_events WHERE user_id = ANY($1) OR target_user_id = ANY($1)`, [created]).catch(() => undefined);
      // Un compte avec trace dans un journal en ajout seul ne se supprime pas : on le laisse désactivé.
      for (const id of created) {
        await p().query(`DELETE FROM users WHERE id = $1`, [id]).catch(() => p().query(`UPDATE users SET is_active = false WHERE id = $1`, [id]).catch(() => undefined));
      }
    }
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('2FA exigée pour un compte, visible dans la liste, puis réinitialisée (sessions fermées)', async () => {
    const r = await request(app).put(`/users/${staffId}/mfa-required`).send({ required: true });
    expect(r.status).toBe(200);
    const { mfaRepository } = await import('../../repositories/mfa.repository.js');
    expect(await mfaRepository.state(staffId, ['cashier'])).toMatchObject({ required: true, requiredForUser: true, requiredByRole: false });
    const list = await request(app).get('/users');
    expect(list.body.data.find((u: { id: string }) => u.id === staffId)).toMatchObject({ mfaRequired: true, mfaRequiredForUser: true, mfaEnabled: false });

    await p().query(`UPDATE users SET totp_enabled = true, totp_secret_enc = 'x', totp_backup_codes = '["h"]' WHERE id = $1`, [staffId]);
    const before = (await p().query(`SELECT token_version FROM users WHERE id = $1`, [staffId])).rows[0].token_version;
    expect((await request(app).post(`/users/${staffId}/mfa-reset`).send({})).status).toBe(200);
    const after = (await p().query(`SELECT totp_enabled, totp_secret_enc, token_version, mfa_required FROM users WHERE id = $1`, [staffId])).rows[0];
    expect(after).toMatchObject({ totp_enabled: false, totp_secret_enc: null, mfa_required: true });
    expect(after.token_version).toBe(before + 1);

    // Sa propre 2FA ne se réinitialise pas ici (une session volée suffirait à la retirer).
    await p().query(`UPDATE users SET totp_enabled = true, totp_secret_enc = 'x' WHERE id = $1`, [adminId]);
    const self = await request(app).post(`/users/${adminId}/mfa-reset`).send({});
    expect(self.status).toBe(403);
    expect((await p().query(`SELECT totp_enabled FROM users WHERE id = $1`, [adminId])).rows[0].totp_enabled).toBe(true);
    await p().query(`UPDATE users SET totp_enabled = false, totp_secret_enc = NULL WHERE id = $1`, [adminId]);
  });

  it('refuse de se désactiver soi-même et de désactiver/supprimer/rétrograder le dernier administrateur', async () => {
    const self = await request(app).delete(`/users/${adminId}`);
    expect(self.status).toBe(400);
    expect(self.body.error.message).toMatch(/votre propre compte/);

    actor = staffId; // un autre compte agit : seul le garde « dernier administrateur » joue
    expect((await request(app).put(`/users/${adminId}`).send({ isActive: false })).body.error.message).toMatch(/dernier administrateur/);
    expect((await request(app).delete(`/users/${adminId}/permanent`)).body.error.message).toMatch(/dernier administrateur/);
    expect((await request(app).put(`/users/${adminId}`).send({ roles: ['cashier'] })).body.error.message).toMatch(/dernier administrateur/);

    // Un second administrateur actif lève le garde-fou.
    await p().query(`UPDATE users SET is_active = true WHERE id = $1`, [otherAdminId]);
    actor = otherAdminId;
    expect((await request(app).put(`/users/${adminId}`).send({ isActive: false })).status).toBe(200);
    await p().query(`UPDATE users SET is_active = true WHERE id = $1`, [adminId]);
    actor = adminId;
  });

  it('suppression définitive : compte vierge supprimé, compte avec historique refusé (409)', async () => {
    await p().query(
      `INSERT INTO config_audit_log (table_name, operation, record_id, changed_by) VALUES ('test', 'UPDATE', 'x', $1)`, [histId]);
    const refused = await request(app).delete(`/users/${histId}/permanent`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('USER_HAS_HISTORY');
    expect(refused.body.error.details.tables).toContain('config_audit_log');
    expect((await p().query(`SELECT 1 FROM users WHERE id = $1`, [histId])).rowCount).toBe(1);

    // Une connexion seule (auth_events) n'est pas un historique métier.
    await p().query(`INSERT INTO auth_events (event_type, user_id, success) VALUES ('login_success', $1, true)`, [freshId]);
    const ok = await request(app).delete(`/users/${freshId}/permanent`);
    expect(ok.status).toBe(200);
    expect((await p().query(`SELECT 1 FROM users WHERE id = $1`, [freshId])).rowCount).toBe(0);
    const trace = (await p().query(`SELECT email, details FROM auth_events WHERE event_type = 'user_deleted' AND details->>'deletedUserId' = $1`, [freshId])).rows[0];
    expect(trace.email).toBe(`adm-fresh-${RUN}@test.local`);
  });

  it('déverrouille un compte et ferme ses sessions', async () => {
    await p().query(`UPDATE users SET failed_login_count = 5, locked_until = now() + interval '10 minutes' WHERE id = $1`, [staffId]);
    const list = await request(app).get('/users');
    expect(list.body.data.find((u: { id: string }) => u.id === staffId).lockedUntil).not.toBeNull();
    expect((await request(app).post(`/users/${staffId}/unlock`).send({})).status).toBe(200);
    const u = (await p().query(`SELECT failed_login_count, locked_until, token_version FROM users WHERE id = $1`, [staffId])).rows[0];
    expect(u).toMatchObject({ failed_login_count: 0, locked_until: null });
    expect((await request(app).post(`/users/${staffId}/revoke-sessions`).send({})).status).toBe(200);
    expect((await p().query(`SELECT token_version FROM users WHERE id = $1`, [staffId])).rows[0].token_version).toBe(u.token_version + 1);
  });
});
