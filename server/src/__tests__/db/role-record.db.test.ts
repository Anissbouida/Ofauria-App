/**
 * Refonte Utilisateurs, lot 4 (mig 703) — fiche rôle :
 *  - création depuis un modèle du secteur (code et page d'accueil du modèle, origine « modèle »),
 *    ou rôle vide (aucun droit) ;
 *  - page d'accueil modifiable (route interne, « / » = accueil général) ;
 *  - niveaux d'accès et permissions détaillées enregistrés ensemble ;
 *  - fiche : membres (principal, secondaire), origine, contrôles.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { PERMISSIONS } from '@ofauria/shared';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

const code = (prefix: string) => `${prefix}_${RUN}`.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 30);

describe.skipIf(!hasTestDb)('Fiche rôle (refonte Utilisateurs, lot 4)', () => {
  let app: express.Express;
  const p = () => testPool();
  const roles: string[] = [];
  const users: string[] = [];
  const tpl = code('tpl');
  let actorId = '';

  beforeAll(async () => {
    await importRepositories();
    const { roleController } = await import('../../controllers/role.controller.js');
    actorId = (await p().query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active) VALUES ($1, 'x', 'Act', 'Eur', 'manager', true) RETURNING id`,
      [`role-rec-actor-${RUN}@test.local`])).rows[0].id;
    users.push(actorId);
    app = express(); app.use(express.json());
    app.use((req, _res, next) => { (req as never as { user: unknown }).user = { userId: actorId, role: 'admin' }; next(); });
    app.get('/roles', (req, res) => roleController.list(req as never, res));
    app.get('/roles/templates', (req, res) => roleController.templates(req as never, res));
    app.post('/roles', (req, res) => roleController.create(req as never, res));
    app.put('/roles/:code', (req, res) => roleController.update(req as never, res));
    app.put('/roles/:code/permissions', (req, res) => roleController.setPermissions(req as never, res));
    app.get('/roles/:code/profile', (req, res) => roleController.profile(req as never, res));
    await p().query(
      `INSERT INTO sector_role_templates (code, label, description, base_role, requires_modules, permissions, home_route)
       VALUES ($1, 'Acheteur test', 'Modèle de test', 'manager', '{}', $2::jsonb, '/purchasing')`,
      [tpl, JSON.stringify([{ module: 'purchasing', rights: 'vce', scope: 'all' }])]);
  });

  afterAll(async () => {
    if (users.length) await p().query(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [users]);
    try { await p().query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]); }
    catch { await p().query(`UPDATE users SET is_active = false WHERE id = ANY($1::uuid[])`, [users]); }
    if (roles.length) {
      await p().query(`DELETE FROM role_action_permissions WHERE role_code = ANY($1::text[])`, [roles]);
      await p().query(`DELETE FROM role_permissions WHERE role_code = ANY($1::text[])`, [roles]);
      await p().query(`DELETE FROM roles WHERE code = ANY($1::text[])`, [roles]);
    }
    await p().query(`DELETE FROM sector_role_templates WHERE code = $1`, [tpl]);
    await closeTestPool();
  });

  it('propose le modèle tant que son rôle n\'existe pas, puis crée le rôle avec sa page d\'accueil', async () => {
    const offered = await request(app).get('/roles/templates');
    expect(offered.body.data.map((t: { code: string }) => t.code)).toContain(tpl);
    const res = await request(app).post('/roles').send({ label: 'Acheteur', template: tpl });
    expect(res.status).toBe(201);
    roles.push(tpl);
    expect(res.body.data).toEqual(expect.objectContaining({ code: tpl, label: 'Acheteur', base_role: 'manager', home_route: '/purchasing' }));
    const perms = (await p().query(`SELECT module, can_create FROM role_permissions WHERE role_code = $1`, [tpl])).rows;
    expect(perms).toEqual([{ module: 'purchasing', can_create: true }]);
    const listed = (await request(app).get('/roles')).body.data.find((r: { code: string }) => r.code === tpl);
    expect(listed.origin).toBe('template');
    expect((await request(app).get('/roles/templates')).body.data.map((t: { code: string }) => t.code)).not.toContain(tpl);
    expect((await request(app).post('/roles').send({ label: 'Encore', template: tpl })).status).toBe(409);
  });

  it('crée un rôle vide, sans aucun droit', async () => {
    const c = code('vide');
    const res = await request(app).post('/roles').send({ label: `Vide ${RUN}`, code: c, baseRole: 'cashier', empty: true });
    expect(res.status).toBe(201);
    roles.push(c);
    expect((await p().query(`SELECT count(*)::int AS n FROM role_permissions WHERE role_code = $1`, [c])).rows[0].n).toBe(0);
    expect((await p().query(`SELECT count(*)::int AS n FROM role_action_permissions WHERE role_code = $1`, [c])).rows[0].n).toBe(0);
    const listed = (await request(app).get('/roles')).body.data.find((r: { code: string }) => r.code === c);
    expect(listed.origin).toBe('custom');
  });

  it('modifie la page d\'accueil ; « / » revient à l\'accueil du secteur ; une adresse externe est refusée', async () => {
    const c = roles[1];
    expect((await request(app).put(`/roles/${c}`).send({ homeRoute: '/stock' })).body.data.home_route).toBe('/stock');
    expect((await request(app).put(`/roles/${c}`).send({ homeRoute: 'https://exemple.ma' })).status).toBe(400);
    expect((await request(app).put(`/roles/${c}`).send({ homeRoute: '/' })).body.data.home_route).toBeNull();
  });

  it('enregistre niveaux d\'accès et permissions détaillées ensemble ; une clé inconnue n\'écrit rien', async () => {
    const c = roles[1];
    const keys = Object.entries(PERMISSIONS as Record<string, { module: string }>).filter(([, d]) => d.module === 'purchasing').map(([k]) => k).slice(0, 3);
    const perms = [{ module: 'purchasing', canView: true, canCreate: true, canEdit: false, canDelete: false, scope: 'store' }];
    const bad = await request(app).put(`/roles/${c}/permissions`).send({ permissions: perms, keys: [...keys, 'inconnue.cle'] });
    expect(bad.status).toBe(400);
    expect((await p().query(`SELECT count(*)::int AS n FROM role_permissions WHERE role_code = $1`, [c])).rows[0].n).toBe(0);
    const ok = await request(app).put(`/roles/${c}/permissions`).send({ permissions: perms, keys });
    expect(ok.status).toBe(200);
    const stored = (await p().query(`SELECT permission_key FROM role_action_permissions WHERE role_code = $1 ORDER BY 1`, [c])).rows.map(r => r.permission_key);
    expect(stored).toEqual([...keys].sort());
  });

  it('la fiche réunit membres, origine et contrôles', async () => {
    const c = roles[1];
    const member = (await p().query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active) VALUES ($1, 'x', 'Mem', 'Bre', 'cashier', true) RETURNING id`,
      [`role-rec-member-${RUN}@test.local`])).rows[0].id;
    users.push(member);
    await p().query(`INSERT INTO user_roles (user_id, role_code, is_primary) VALUES ($1, 'cashier', true), ($1, $2, false)`, [member, c]);
    const res = await request(app).get(`/roles/${c}/profile`);
    expect(res.status).toBe(200);
    expect(res.body.data.origin).toBe('custom');
    expect(res.body.data.members).toEqual([expect.objectContaining({ id: member, as: 'secondary', isActive: true })]);
    expect(res.body.data.mfaRequired).toBe(false);
    expect(res.body.data.actionKeys.length).toBe(3);
    expect((await request(app).get('/roles/inconnu_xyz/profile')).status).toBe(404);
  });
});
