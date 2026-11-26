/**
 * Refonte Utilisateurs, lot 10 (mig 710) :
 *  - administration déléguée : un gérant qui a les droits « Utilisateurs » ne gère que les comptes
 *    de ses établissements, ni administrateur ni autre gestionnaire, et n'attribue ni le rôle
 *    Administrateur ni un rôle de gestion des comptes ;
 *  - changement sensible : l'attribution du rôle Administrateur est mise en attente et s'applique
 *    quand un AUTRE administrateur l'approuve.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Administration déléguée et approbations (refonte Utilisateurs, lot 10)', () => {
  let app: express.Express;
  const p = () => testPool();
  const role = `dlg_${RUN}`.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 30);
  const stores: string[] = [];
  const users: string[] = [];
  const ids: Record<string, string> = {};
  let actor = '';
  let previousApprovals: unknown = null;

  const mk = async (tag: string, r: string, store: string | null) => {
    const id = (await p().query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active, store_id) VALUES ($1, 'x', $2, 'Test', $3, true, $4) RETURNING id`,
      [`dlg-${tag}-${RUN}@test.local`, tag, r, store])).rows[0].id as string;
    await p().query(`INSERT INTO user_roles (user_id, role_code, is_primary) VALUES ($1, $2, true)`, [id, r]);
    users.push(id); ids[tag] = id;
    return id;
  };

  beforeAll(async () => {
    await importRepositories();
    await import('../../services/approval-handlers.js');
    const { userController } = await import('../../controllers/user.controller.js');
    const { accountScope } = await import('../../services/account-scope.js');
    const perms = await import('../../services/permissions.js');
    previousApprovals = (await p().query(`SELECT value FROM module_parameters WHERE key = 'security.approvals'`)).rows[0]?.value ?? null;
    for (const n of ['A', 'B']) stores.push((await p().query(`INSERT INTO stores (name) VALUES ($1) RETURNING id`, [`Dlg ${n} ${RUN}`])).rows[0].id);
    await p().query(`INSERT INTO roles (code, label, base_role, is_system) VALUES ($1, 'Gérant délégué test', 'manager', false)`, [role]);
    await perms.seedPermissions();
    await p().query(`DELETE FROM role_action_permissions WHERE role_code = $1`, [role]);
    await p().query(`INSERT INTO role_action_permissions (role_code, permission_key) VALUES ($1, 'users.view'), ($1, 'users.edit'), ($1, 'users.create')`, [role]);
    await mk('mgr', role, stores[0]); await mk('t1', 'cashier', stores[0]); await mk('t2', 'cashier', stores[1]); await mk('mgr2', role, stores[0]);
    await mk('adm1', 'admin', null); await mk('adm2', 'admin', null);
    perms.invalidatePermissionCaches();
    const { invalidateRolesCache } = await import('../../services/access-rights.js');
    invalidateRolesCache();
    app = express(); app.use(express.json());
    app.use((req, _res, next) => { (req as never as { user: unknown }).user = { userId: actor, role: actor === ids.adm1 || actor === ids.adm2 ? 'admin' : 'manager' }; next(); });
    app.get('/users', (req, res) => userController.list(req as never, res));
    app.put('/users/:id', accountScope('write') as never, (req, res) => userController.update(req as never, res));
    app.put('/approvals', (req, res) => userController.setAccessApprovals(req as never, res));
  });

  afterAll(async () => {
    if (previousApprovals) await p().query(`UPDATE module_parameters SET value = $1 WHERE key = 'security.approvals'`, [JSON.stringify(previousApprovals)]);
    await p().query(`DELETE FROM approval_requests WHERE doc_type = 'access_change' AND requested_by = ANY($1::uuid[])`, [users]).catch(() => undefined);
    await p().query(`DELETE FROM pending_access_changes WHERE requested_by = ANY($1::uuid[])`, [users]);
    await p().query(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [users]);
    await p().query(`DELETE FROM user_stores WHERE user_id = ANY($1::uuid[])`, [users]);
    try { await p().query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]); }
    catch { await p().query(`UPDATE users SET is_active = false, role = 'cashier', store_id = NULL WHERE id = ANY($1::uuid[])`, [users]); }
    await p().query(`DELETE FROM role_action_permissions WHERE role_code = $1`, [role]);
    await p().query(`DELETE FROM roles WHERE code = $1`, [role]).catch(() => undefined);
    try { await p().query(`DELETE FROM stores WHERE id = ANY($1::uuid[])`, [stores]); }
    catch { await p().query(`UPDATE stores SET is_active = false WHERE id = ANY($1::uuid[])`, [stores]); }
    await closeTestPool();
  });

  it('un gérant délégué ne voit que les comptes de ses établissements', async () => {
    actor = ids.mgr;
    const list = (await request(app).get('/users')).body.data.map((u: { id: string }) => u.id);
    expect(list).toEqual(expect.arrayContaining([ids.mgr, ids.t1, ids.mgr2]));
    expect(list).not.toContain(ids.t2);
    expect(list).not.toContain(ids.adm1);
  });

  it('il gère un compte de son établissement, sans rôle ni établissement réservés', async () => {
    actor = ids.mgr;
    expect((await request(app).put(`/users/${ids.t1}`).send({ firstName: 'Modifié' })).status).toBe(200);
    expect((await request(app).put(`/users/${ids.t2}`).send({ firstName: 'Non' })).status).toBe(403);
    expect((await request(app).put(`/users/${ids.mgr2}`).send({ firstName: 'Non' })).status).toBe(403);
    expect((await request(app).put(`/users/${ids.mgr}`).send({ firstName: 'Non' })).status).toBe(403);
    expect((await request(app).put(`/users/${ids.t1}`).send({ roles: ['cashier', 'admin'], primaryRole: 'cashier' })).status).toBe(403);
    expect((await request(app).put(`/users/${ids.t1}`).send({ roles: ['cashier', role], primaryRole: 'cashier' })).status).toBe(403);
    expect((await request(app).put(`/users/${ids.t1}`).send({ storeIds: [stores[1]], storeId: stores[1] })).status).toBe(403);
  });

  it('attribuer le rôle Administrateur attend l\'approbation d\'un autre administrateur', async () => {
    actor = ids.adm1;
    expect((await request(app).put('/approvals').send({ kinds: ['grant_admin', 'inconnu'] })).status).toBe(400);
    expect((await request(app).put('/approvals').send({ kinds: ['grant_admin'] })).status).toBe(200);
    const res = await request(app).put(`/users/${ids.t1}`).send({ roles: ['cashier', 'admin'], primaryRole: 'cashier' });
    expect(res.status).toBe(200);
    expect(res.body.data.pendingApproval).toBeTruthy();
    expect((await p().query(`SELECT role_code FROM user_roles WHERE user_id = $1`, [ids.t1])).rows.map(r => r.role_code)).toEqual(['cashier']);
    const pending = (await p().query(`SELECT id, approval_request_id FROM pending_access_changes WHERE id = $1`, [res.body.data.pendingApproval.id])).rows[0];
    expect(pending.approval_request_id).toBeTruthy();
    const { approvalService } = await import('../../services/approval.service.js');
    await expect(approvalService.decide(pending.approval_request_id, { userId: ids.adm1, role: 'admin' }, 'approve')).rejects.toThrow();
    await approvalService.decide(pending.approval_request_id, { userId: ids.adm2, role: 'admin' }, 'approve');
    expect((await p().query(`SELECT status FROM pending_access_changes WHERE id = $1`, [pending.id])).rows[0].status).toBe('applied');
    expect((await p().query(`SELECT role_code FROM user_roles WHERE user_id = $1 ORDER BY role_code`, [ids.t1])).rows.map(r => r.role_code)).toEqual(['admin', 'cashier']);
  });
});
