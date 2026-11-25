/**
 * Fiche d'un compte (refonte Utilisateurs, lot 2) :
 *  - rattachements lus dans les autres modules (atelier de production par rôle, délégation reçue) ;
 *  - langue et espace de travail réglés par l'administrateur, null = valeur de la société.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Fiche d\'un compte : rattachements et préférences (refonte Utilisateurs, lot 2)', () => {
  let app: express.Express;
  const p = () => testPool();
  let adminId = ''; let userId = ''; let otherId = '';
  let workshop: string | null = null; let delegationId: number | null = null;
  const wsCode = `t${RUN}`.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 20);

  beforeAll(async () => {
    await importRepositories();
    const { userController } = await import('../../controllers/user.controller.js');
    const mk = async (tag: string, role: string) => (await p().query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active) VALUES ($1, 'x', 'Fiche', $2, $3, true) RETURNING id`,
      [`profile-${tag}-${RUN}@test.local`, tag, role])).rows[0].id as string;
    // Rôle non administrateur : un administrateur actif de plus fausserait, en parallèle, le test
    // du garde-fou « dernier administrateur » (user-admin-security).
    adminId = await mk('admin', 'manager');
    userId = await mk('user', 'magasinier');
    otherId = await mk('other', 'manager');
    app = express(); app.use(express.json());
    app.use((req, _res, next) => { (req as never as { user: unknown }).user = { userId: adminId, role: 'admin' }; next(); });
    app.get('/users/:id/profile', (req, res) => userController.profile(req as never, res));
    app.put('/users/:id/preferences', (req, res) => userController.setPreferences(req as never, res));
    // Atelier dont le rôle Magasinier est membre (mig 511), si la table existe.
    if ((await p().query(`SELECT to_regclass('public.production_workshop_members') IS NOT NULL AS ok`)).rows[0].ok) {
      await p().query(`INSERT INTO production_workshops (code, label, is_active) VALUES ($1, 'Atelier test', true)`, [wsCode]);
      await p().query(`INSERT INTO production_workshop_members (workshop_code, role_code) VALUES ($1, 'magasinier')`, [wsCode]);
      workshop = wsCode;
    }
    delegationId = (await p().query(
      `INSERT INTO role_delegations (from_user_id, to_user_id, role_code, reason, starts_at, ends_at)
       VALUES ($1, $2, 'manager', 'Congé', now() - interval '1 day', now() + interval '5 days') RETURNING id`, [otherId, userId])).rows[0].id;
  });

  afterAll(async () => {
    if (delegationId) await p().query(`DELETE FROM role_delegations WHERE id = $1`, [delegationId]);
    if (workshop) {
      await p().query(`DELETE FROM production_workshop_members WHERE workshop_code = $1`, [workshop]);
      await p().query(`DELETE FROM production_workshops WHERE code = $1`, [workshop]);
    }
    const ids = [adminId, userId, otherId].filter(Boolean);
    if ((await p().query(`SELECT to_regclass('public.config_values') IS NOT NULL AS ok`)).rows[0].ok) {
      await p().query(`DELETE FROM config_values WHERE scope_type = 'user' AND scope_id = ANY($1::text[])`, [ids]);
    }
    await p().query(`DELETE FROM auth_events WHERE user_id = ANY($1::uuid[]) OR target_user_id = ANY($1::uuid[])`, [ids]);
    await p().query(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [ids]);
    // Un compte cité par le journal de configuration (ajout seul) ne se supprime plus : il est
    // désactivé, comme le ferait l'application.
    try { await p().query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids]); }
    catch { await p().query(`UPDATE users SET is_active = false WHERE id = ANY($1::uuid[])`, [ids]); }
    await closeTestPool();
  });

  it('réunit les rattachements du compte (atelier par rôle, délégation reçue)', async () => {
    const res = await request(app).get(`/users/${userId}/profile`);
    expect(res.status).toBe(200);
    if (workshop) expect(res.body.data.workshops).toEqual(expect.arrayContaining([expect.objectContaining({ code: workshop, via: 'role', roleCode: 'magasinier' })]));
    expect(res.body.data.delegations).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'role', direction: 'received', roleCode: 'manager', active: true })]));
    expect(res.body.data.preferences.locale).toBeNull();
  });

  it('règle la langue et l\'espace de travail du compte, puis revient à la valeur de la société', async () => {
    const set = await request(app).put(`/users/${userId}/preferences`).send({ locale: 'ar', workspace: 'production' });
    expect(set.status).toBe(200);
    expect(set.body.data.locale).toBe('ar');
    const available = (await p().query(`SELECT to_regclass('public.config_values') IS NOT NULL AS ok`)).rows[0].ok;
    if (available) {
      expect(set.body.data.workspace).toBe('production');
      // Écrit par l'administrateur, pas par le compte lui-même.
      const row = (await p().query(`SELECT updated_by FROM config_values WHERE key = 'ui.workspace' AND scope_type = 'user' AND scope_id = $1`, [userId])).rows[0];
      expect(row.updated_by).toBe(adminId);
    }
    const reset = await request(app).put(`/users/${userId}/preferences`).send({ locale: null, workspace: null });
    expect(reset.status).toBe(200);
    expect(reset.body.data.locale).toBeNull();
    expect(reset.body.data.workspace).toBeNull();
  });

  it('répond 404 pour un compte inconnu', async () => {
    const res = await request(app).get('/users/00000000-0000-4000-8000-000000000000/profile');
    expect(res.status).toBe(404);
  });
});
