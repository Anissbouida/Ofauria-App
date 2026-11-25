/**
 * Refonte Utilisateurs, lot 0 :
 *  - rôle de base : tout rôle système actif est accepté (plus seulement 8 rôles de boulangerie),
 *    l'administrateur reste exclu ;
 *  - un rôle encore détenu par un compte désactivé ne se supprime pas (clé étrangère users.role).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

const code = (prefix: string) => `${prefix}_${RUN}`.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 30);

describe.skipIf(!hasTestDb)('Rôles : rôle de base et suppression (refonte Utilisateurs, lot 0)', () => {
  let app: express.Express;
  const p = () => testPool();
  const roles: string[] = [];
  const users: string[] = [];
  let systemBase = '';

  beforeAll(async () => {
    await importRepositories();
    const { roleController } = await import('../../controllers/role.controller.js');
    app = express(); app.use(express.json());
    app.use((req, _res, next) => { (req as never as { user: unknown }).user = { userId: undefined, role: 'admin' }; next(); });
    app.post('/roles', (req, res) => roleController.create(req as never, res));
    app.delete('/roles/:code', (req, res) => roleController.remove(req as never, res));
    // Un rôle système actif hors des huit rôles historiques (ex. opérateur de production, mig 637).
    const legacy = ['admin', 'manager', 'cashier', 'saleswoman', 'baker', 'pastry_chef', 'viennoiserie', 'beldi_sale', 'magasinier'];
    const r = await p().query(`SELECT code FROM roles WHERE is_system AND is_active AND code <> ALL($1::text[]) ORDER BY code LIMIT 1`, [legacy]);
    systemBase = r.rows[0]?.code ?? '';
  });

  afterAll(async () => {
    if (users.length) await p().query(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [users]);
    if (users.length) await p().query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]);
    if (roles.length) await p().query(`DELETE FROM role_permissions WHERE role_code = ANY($1::text[])`, [roles]);
    if (roles.length) await p().query(`DELETE FROM roles WHERE code = ANY($1::text[])`, [roles]);
    await closeTestPool();
  });

  it('accepte un rôle système hors de la liste historique comme rôle de base', async () => {
    if (!systemBase) return; // base de test sans autre rôle système : rien à vérifier
    const res = await request(app).post('/roles').send({ label: `Base ${RUN}`, code: code('tb'), baseRole: systemBase });
    expect(res.status).toBe(201);
    roles.push(res.body.data.code);
  });

  it('refuse l\'administrateur et un rôle non système comme rôle de base', async () => {
    const admin = await request(app).post('/roles').send({ label: `Adm ${RUN}`, code: code('ta'), baseRole: 'admin' });
    expect(admin.status).toBe(400);
    const custom = await request(app).post('/roles').send({ label: `Cus ${RUN}`, code: code('tc'), baseRole: roles[0] ?? 'inexistant' });
    expect(custom.status).toBe(400);
  });

  it('refuse de supprimer un rôle détenu par un compte désactivé', async () => {
    const c = code('td');
    const created = await request(app).post('/roles').send({ label: `Del ${RUN}`, code: c, baseRole: 'cashier' });
    expect(created.status).toBe(201);
    roles.push(c);
    const uid = (await p().query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active) VALUES ($1, 'x', 'Ina', 'Ctif', $2, false) RETURNING id`,
      [`role-del-${RUN}@test.local`, c])).rows[0].id as string;
    users.push(uid);
    const res = await request(app).delete(`/roles/${c}`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/désactivé/);
    // Une fois le compte retiré, la suppression passe.
    await p().query(`DELETE FROM user_roles WHERE user_id = $1`, [uid]);
    await p().query(`DELETE FROM users WHERE id = $1`, [uid]);
    users.pop();
    const ok = await request(app).delete(`/roles/${c}`);
    expect(ok.status).toBe(200);
    roles.pop();
  });
});
