/**
 * Refonte Utilisateurs, lot 6 (mig 706) — exceptions individuelles qui s'ajoutent aux rôles :
 *  - une exception de module remplace les droits des rôles pour CE module, les autres suivent les rôles ;
 *  - une exception d'action accorde ou retire une clé ;
 *  - motif obligatoire, date de fin facultative ; passé ce jour, l'exception ne compte plus ;
 *  - refus : exception sans effet, date de fin passée, compte administrateur.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Exceptions individuelles (refonte Utilisateurs, lot 6)', () => {
  let app: express.Express;
  const p = () => testPool();
  const role = `exc_${RUN}`.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 30);
  const users: string[] = [];
  let actorId = ''; let userId = ''; let adminId = '';
  let access: typeof import('../../services/access-rights.js');
  let perms: typeof import('../../services/permissions.js');
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString('sv-SE');

  const mkUser = async (tag: string, r: string) => (await p().query(
    `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active) VALUES ($1, 'x', $2, 'Test', $3, true) RETURNING id`,
    [`exc-${tag}-${RUN}@test.local`, tag, r])).rows[0].id as string;

  beforeAll(async () => {
    await importRepositories();
    const { userController } = await import('../../controllers/user.controller.js');
    access = await import('../../services/access-rights.js');
    perms = await import('../../services/permissions.js');
    await p().query(`INSERT INTO roles (code, label, base_role, is_system) VALUES ($1, 'Exceptions test', 'cashier', false)`, [role]);
    await p().query(
      `INSERT INTO role_permissions (role_code, module, can_view, can_create, can_edit, can_delete, config)
       VALUES ($1, 'sales', true, true, false, false, '{}'::jsonb), ($1, 'pos', true, true, true, false, '{}'::jsonb)`, [role]);
    await perms.seedPermissions();
    await p().query(`DELETE FROM role_action_permissions WHERE role_code = $1`, [role]);
    await p().query(`INSERT INTO role_action_permissions (role_code, permission_key) VALUES ($1, 'sales.cancel')`, [role]);
    actorId = await mkUser('actor', 'manager'); userId = await mkUser('user', role); adminId = await mkUser('admin', 'admin');
    users.push(actorId, userId, adminId);
    await p().query(`INSERT INTO user_roles (user_id, role_code, is_primary) VALUES ($1, $2, true)`, [userId, role]);
    access.invalidateRolesCache(); perms.invalidatePermissionCaches();
    app = express(); app.use(express.json());
    app.use((req, _res, next) => { (req as never as { user: unknown }).user = { userId: actorId, role: 'admin' }; next(); });
    app.get('/users/:id/exceptions', (req, res) => userController.exceptions(req as never, res));
    app.put('/users/:id/exceptions/modules/:module', (req, res) => userController.setModuleException(req as never, res));
    app.put('/users/:id/exceptions/actions/:key', (req, res) => userController.setActionException(req as never, res));
    app.delete('/users/:id/exceptions/:kind/:ref', (req, res) => userController.removeException(req as never, res));
  });

  afterAll(async () => {
    await p().query(`DELETE FROM user_permissions WHERE user_id = ANY($1::uuid[])`, [users]);
    await p().query(`DELETE FROM user_action_permissions WHERE user_id = ANY($1::uuid[])`, [users]);
    await p().query(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [users]);
    try { await p().query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]); }
    catch { await p().query(`UPDATE users SET is_active = false, role = 'cashier' WHERE id = ANY($1::uuid[])`, [users]); }
    await p().query(`DELETE FROM role_action_permissions WHERE role_code = $1`, [role]);
    await p().query(`DELETE FROM role_permissions WHERE role_code = $1`, [role]);
    await p().query(`DELETE FROM roles WHERE code = $1`, [role]);
    await closeTestPool();
  });

  it('accorde un module en plus des rôles, sans toucher aux autres modules', async () => {
    const res = await request(app).put(`/users/${userId}/exceptions/modules/accounting`).send({
      canView: true, canCreate: false, canEdit: false, canDelete: false, verbs: ['export'], scope: 'all',
      reason: 'Rapprochement des factures', endsOn: day(30),
    });
    expect(res.status).toBe(200);
    expect(res.body.data.effect).toBe('grant');
    const rights = await access.effectiveRights(userId);
    expect(access.hasRight(rights, ['accounting'], 'view')).toBe(true);
    expect(access.hasRight(rights, ['sales'], 'create')).toBe(true);
    expect(access.hasRight(rights, ['pos'], 'edit')).toBe(true);
    const list = (await request(app).get(`/users/${userId}/exceptions`)).body.data;
    expect(list.modules).toEqual([expect.objectContaining({ module: 'accounting', effect: 'grant', active: true, reason: 'Rapprochement des factures', endsOn: day(30), verbs: ['export'], scope: 'all' })]);
    expect(list.roleModules.map((m: { module: string }) => m.module).sort()).toEqual(['pos', 'sales']);
  });

  it('retire un module donné par le rôle ; refuse une exception sans effet', async () => {
    const res = await request(app).put(`/users/${userId}/exceptions/modules/pos`).send({
      canView: false, canCreate: false, canEdit: false, canDelete: false, reason: 'Pas de caisse sur ce poste',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.effect).toBe('revoke');
    expect(access.hasRight(await access.effectiveRights(userId), ['pos'], 'view')).toBe(false);
    const same = await request(app).put(`/users/${userId}/exceptions/modules/sales`).send({
      canView: true, canCreate: true, canEdit: false, canDelete: false, reason: 'Identique au rôle',
    });
    expect(same.status).toBe(400);
  });

  it('une exception expirée ne compte plus ; une date de fin passée est refusée', async () => {
    expect((await request(app).put(`/users/${userId}/exceptions/modules/products`).send({
      canView: true, canCreate: false, canEdit: false, canDelete: false, reason: 'Trop tard', endsOn: day(-1),
    })).status).toBe(400);
    await p().query(
      `INSERT INTO user_permissions (user_id, module, can_view, config, reason, ends_on) VALUES ($1, 'products', true, '{}', 'Ancienne', $2)`,
      [userId, day(-2)]);
    expect(access.hasRight(await access.effectiveRights(userId), ['products'], 'view')).toBe(false);
    const list = (await request(app).get(`/users/${userId}/exceptions`)).body.data;
    expect(list.modules.find((m: { module: string }) => m.module === 'products')).toEqual(expect.objectContaining({ active: false }));
  });

  it('accorde ou retire une action précise', async () => {
    expect((await request(app).put(`/users/${userId}/exceptions/actions/sales.cancel`).send({ granted: false, reason: 'Séparation avec la caisse' })).status).toBe(200);
    expect((await request(app).put(`/users/${userId}/exceptions/actions/sales.checkout`).send({ granted: true, reason: 'Renfort samedi', endsOn: day(3) })).status).toBe(200);
    perms.invalidatePermissionCaches();
    expect(await perms.hasPermission({ userId }, 'sales.cancel')).toBe(false);
    expect(await perms.hasPermission({ userId }, 'sales.checkout')).toBe(true);
    // Sans effet (le rôle ne la donne pas) et clé inconnue : refusés.
    expect((await request(app).put(`/users/${userId}/exceptions/actions/sales.delivery_notes.cancel`).send({ granted: false, reason: 'Rien à retirer' })).status).toBe(400);
    expect((await request(app).put(`/users/${userId}/exceptions/actions/inconnue.cle`).send({ granted: true, reason: 'Clé inconnue' })).status).toBe(400);
    // Expirée : la clé suit à nouveau le rôle.
    await p().query(`UPDATE user_action_permissions SET ends_on = $2 WHERE user_id = $1 AND permission_key = 'sales.cancel'`, [userId, day(-1)]);
    perms.invalidatePermissionCaches();
    expect(await perms.hasPermission({ userId }, 'sales.cancel')).toBe(true);
    const list = (await request(app).get(`/users/${userId}/exceptions`)).body.data;
    expect(list.actions.find((a: { key: string }) => a.key === 'sales.checkout')).toEqual(expect.objectContaining({ granted: true, effect: 'grant', roleHolds: false, active: true }));
  });

  it('retire une exception ; refuse toute exception sur un administrateur', async () => {
    expect((await request(app).delete(`/users/${userId}/exceptions/modules/pos`)).status).toBe(200);
    expect((await request(app).delete(`/users/${userId}/exceptions/modules/pos`)).status).toBe(404);
    expect(access.hasRight(await access.effectiveRights(userId), ['pos'], 'view')).toBe(true);
    expect((await request(app).delete(`/users/${userId}/exceptions/actions/sales.checkout`)).status).toBe(200);
    expect((await request(app).put(`/users/${adminId}/exceptions/modules/accounting`).send({
      canView: true, canCreate: false, canEdit: false, canDelete: false, reason: 'Inutile',
    })).status).toBe(400);
  });
});
