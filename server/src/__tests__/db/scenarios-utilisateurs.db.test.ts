/**
 * Scénarios UTILISATEURS / DROITS — bout en bout sur base migrée (TEST_DATABASE_URL).
 *
 * Vérifie la chaîne réelle des droits (access-rights.ts) contre la vraie base :
 *   - effectiveRights(admin)       : isAdmin, portée « all » (effectiveScopeFor) ;
 *   - rôle non-admin + role_permissions : droits et portée (config.scope) lus en base ;
 *   - rôles multiples (mig 335, user_roles) : UNION des droits de tous les rôles ;
 *   - exceptions utilisateur (user_permissions) : remplacent les droits du rôle ;
 *   - authorizeModule de bout en bout : admin toujours, rôle sans le module -> 403.
 *
 * Chaque test isole ses données avec le suffixe RUN et nettoie en fin de suite.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import pg from 'pg';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const hasTestDb = Boolean(TEST_DATABASE_URL);
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/* eslint-disable @typescript-eslint/no-explicit-any */

// Modules serveur importés dynamiquement après avoir posé l'env (sinon env.ts lève).
let accessRights: any;
let pool: pg.Pool;

// Codes de rôle custom (non-système) pour ne pas polluer les droits des rôles seedés.
const R_CASH = `t_cash_${RUN}`;     // base = cashier (non-admin)
const R_MAG = `t_mag_${RUN}`;       // base = magasinier (non-admin)
// NB : un rôle custom (non-système) ne peut PAS avoir base_role='admin'
// (CHECK roles_base_coherent) ; l'admin est joué via users.role='admin'.

const ids = { store: '', uAdmin: '', uCashier: '', uMulti: '', uOverride: '' };

async function makeUser(tag: string, role: string): Promise<string> {
  const r = await pool.query(
    `INSERT INTO users (email, password_hash, first_name, last_name, role, store_id)
     VALUES ($1, 'x', 'T', 'U', $2, $3) RETURNING id`,
    [`u-${tag}-${RUN}@test.local`, role, ids.store],
  );
  return r.rows[0].id;
}

describe.skipIf(!hasTestDb)('Scénarios droits — base migrée', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
    pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 3 });

    const store = await pool.query(`INSERT INTO stores (name, city) VALUES ($1, 'Test') RETURNING id`, [`Magasin ${RUN}`]);
    ids.store = store.rows[0].id;

    // Rôles custom créés AVANT tout appel à effectiveRights (cache rôles chargé à la 1re lecture).
    await pool.query(
      `INSERT INTO roles (code, label, base_role, is_system) VALUES
         ($1,'Caisse test','cashier',false),
         ($2,'Magasin test','magasinier',false)`,
      [R_CASH, R_MAG],
    );

    // Droits par rôle : le rôle « caisse » voit POS (portée own) + sales (portée store, défaut).
    await pool.query(
      `INSERT INTO role_permissions (role_code, module, can_view, can_create, can_edit, can_delete, config) VALUES
         ($1,'pos',  true,true,true,false,'{"scope":"own"}'::jsonb),
         ($1,'sales',true,false,false,false,'{}'::jsonb)`,
      [R_CASH],
    );
    // Le rôle « magasin » voit le stock (portée all).
    await pool.query(
      `INSERT INTO role_permissions (role_code, module, can_view, can_create, can_edit, can_delete, config) VALUES
         ($1,'stock',true,true,true,false,'{"scope":"all"}'::jsonb)`,
      [R_MAG],
    );

    // Utilisateurs
    ids.uAdmin = await makeUser('admin', 'admin');     // base admin via users.role (pas de user_roles)
    ids.uCashier = await makeUser('cash', 'cashier');
    ids.uMulti = await makeUser('multi', 'cashier');
    ids.uOverride = await makeUser('override', 'cashier');

    // user_roles (mig 335)
    await pool.query(`INSERT INTO user_roles (user_id, role_code, is_primary) VALUES ($1,$2,true)`, [ids.uCashier, R_CASH]);
    // Multi-rôles : caisse + magasin -> union POS/sales/stock
    await pool.query(`INSERT INTO user_roles (user_id, role_code, is_primary) VALUES ($1,$2,true),($1,$3,false)`, [ids.uMulti, R_CASH, R_MAG]);
    // uOverride a le rôle caisse MAIS une exception utilisateur qui le remplace
    await pool.query(`INSERT INTO user_roles (user_id, role_code, is_primary) VALUES ($1,$2,true)`, [ids.uOverride, R_CASH]);
    await pool.query(
      `INSERT INTO user_permissions (user_id, module, can_view, can_create, can_edit, can_delete, config)
       VALUES ($1,'employees',true,false,true,false,'{"scope":"store"}'::jsonb)`,
      [ids.uOverride],
    );

    accessRights = await import('../../services/access-rights.js');
    accessRights.invalidateRolesCache?.();
  });

  afterAll(async () => {
    const run = async (sql: string, p: unknown[]) => { try { await pool.query(sql, p); } catch { /* best effort */ } };
    await run(`DELETE FROM user_permissions WHERE user_id = ANY($1)`, [[ids.uAdmin, ids.uCashier, ids.uMulti, ids.uOverride]]);
    await run(`DELETE FROM user_roles WHERE user_id = ANY($1)`, [[ids.uAdmin, ids.uCashier, ids.uMulti, ids.uOverride]]);
    await run(`DELETE FROM users WHERE id = ANY($1)`, [[ids.uAdmin, ids.uCashier, ids.uMulti, ids.uOverride]]);
    await run(`DELETE FROM role_permissions WHERE role_code = ANY($1)`, [[R_CASH, R_MAG]]);
    await run(`DELETE FROM roles WHERE code = ANY($1)`, [[R_CASH, R_MAG]]);
    await run(`DELETE FROM stores WHERE id = $1`, [ids.store]);
    const db = accessRights && (await import('../../config/database.js')).db;
    if (db) await db.pool.end();
    await pool.end();
  });

  it('admin (users.role) : isAdmin + aucune restriction, portée « all »', async () => {
    const rights = await accessRights.effectiveRights(ids.uAdmin);
    expect(rights.isAdmin).toBe(true);
    expect(rights.baseRole).toBe('admin');
    expect(await accessRights.effectiveScopeFor(ids.uAdmin, 'sales')).toBe('all');
    expect(await accessRights.effectiveScopeFor(ids.uAdmin, 'stock')).toBe('all');
  });

  it('rôle non-admin (user_roles) : droits lus en base, portée par module', async () => {
    const rights = await accessRights.effectiveRights(ids.uCashier);
    expect(rights.isAdmin).toBe(false);
    expect(rights.source).toBe('role');
    const modules = rights.rows.map((r: any) => r.module).sort();
    expect(modules).toEqual(['pos', 'sales']);
    // POS = own (config.scope), sales = store (défaut sans scope).
    expect(await accessRights.effectiveScopeFor(ids.uCashier, 'pos')).toBe('own');
    expect(await accessRights.effectiveScopeFor(ids.uCashier, 'sales')).toBe('store');
    // Module non accordé -> défaut store.
    expect(await accessRights.effectiveScopeFor(ids.uCashier, 'employees')).toBe('store');
  });

  it('rôles multiples (mig 335) : UNION des droits (POS + sales + stock)', async () => {
    const rights = await accessRights.effectiveRights(ids.uMulti);
    expect(rights.isAdmin).toBe(false);
    expect(rights.roles.sort()).toEqual([R_CASH, R_MAG].sort());
    const modules = rights.rows.map((r: any) => r.module).sort();
    expect(modules).toEqual(['pos', 'sales', 'stock']);
    // stock hérité du rôle magasin = portée all.
    expect(await accessRights.effectiveScopeFor(ids.uMulti, 'stock')).toBe('all');
    expect(await accessRights.effectiveScopeFor(ids.uMulti, 'pos')).toBe('own');
  });

  it('exceptions utilisateur (user_permissions) : remplacent les droits du rôle', async () => {
    const rights = await accessRights.effectiveRights(ids.uOverride);
    expect(rights.source).toBe('user');
    const modules = rights.rows.map((r: any) => r.module);
    // Les droits du rôle (pos/sales) sont ignorés au profit des exceptions (employees).
    expect(modules).toEqual(['employees']);
    expect(accessRights.hasRight(rights, ['employees'], 'edit')).toBe(true);
    expect(accessRights.hasRight(rights, ['pos'], 'view')).toBe(false);
  });

  it('authorizeModule de bout en bout : admin passe, rôle sans module -> 403', async () => {
    const { authorizeModule } = await import('../../middleware/module.middleware.js');
    const ctx = (userId: string, role: string) => {
      const json = vi.fn();
      const status = vi.fn().mockReturnValue({ json });
      const next = vi.fn();
      return { req: { user: { userId, role } } as any, res: { status, json } as any, next, status };
    };

    // Admin : court-circuit, passe toujours.
    const a = ctx(ids.uAdmin, 'admin');
    await authorizeModule('employees' as any, 'delete')(a.req, a.res, a.next);
    expect(a.next).toHaveBeenCalledOnce();

    // Caissier (rôle R_CASH) : pas de droit « employees » -> 403.
    const c = ctx(ids.uCashier, 'cashier');
    await authorizeModule('employees' as any, 'view')(c.req, c.res, c.next);
    expect(c.next).not.toHaveBeenCalled();
    expect(c.status).toHaveBeenCalledWith(403);

    // Caissier sur son module POS accordé -> passe.
    const p = ctx(ids.uCashier, 'cashier');
    await authorizeModule('pos' as any, 'view')(p.req, p.res, p.next);
    expect(p.next).toHaveBeenCalledOnce();
  });
});
