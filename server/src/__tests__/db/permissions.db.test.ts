/**
 * M2-04 — permissions par action (mig 547, services/permissions.ts).
 *  - après amorçage, chaque rôle système détient exactement les clés dont il fait partie
 *    des defaultRoles (= les rôles que la garde authorize d'origine acceptait) ;
 *  - un rôle personnalisé créé reçoit les clés de son rôle de base ;
 *  - une exception utilisateur l'emporte sur les rôles ;
 *  - un retrait fait sur un rôle tient (l'amorçage ne réécrit pas une clé amorcée).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Permissions par action (M2-04)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let perms: typeof import('../../services/permissions.js');
  let roleRepo: typeof import('../../repositories/role.repository.js')['roleRepository'];
  let defs: Record<string, { defaultRoles: readonly string[] }>;
  let admin: string;
  const customRole = `cais_${RUN}`.slice(0, 30).toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    perms = await import('../../services/permissions.js');
    roleRepo = (await import('../../repositories/role.repository.js')).roleRepository;
    defs = (await import('@ofauria/shared')).PERMISSIONS as never;
    admin = (await p().query(`SELECT id FROM users WHERE role = 'admin' AND NOT is_system ORDER BY created_at LIMIT 1`)).rows[0].id;
    await perms.seedPermissions();
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM user_action_permissions WHERE user_id = $1 AND permission_key = 'production.confirm'`, [admin]).catch(() => undefined);
    await p().query(`INSERT INTO role_action_permissions (role_code, permission_key) VALUES ('manager', 'production.complete') ON CONFLICT DO NOTHING`).catch(() => undefined);
    await p().query(`DELETE FROM roles WHERE code = $1`, [customRole]).catch(() => undefined);
    perms?.invalidatePermissionCaches();
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('amorçage : chaque rôle système a exactement les clés de ses defaultRoles', async () => {
    const system = (await p().query(`SELECT code FROM roles WHERE is_system`)).rows.map(r => r.code as string);
    const rows = (await p().query(`SELECT role_code, permission_key FROM role_action_permissions WHERE role_code = ANY($1)`, [system])).rows;
    const have = new Set(rows.map(r => `${r.role_code}|${r.permission_key}`));
    const diffs: string[] = [];
    for (const [k, d] of Object.entries(defs)) {
      // production.complete est retiré au gérant par un test plus bas, puis rendu : on l'ignore ici.
      for (const r of system) if (have.has(`${r}|${k}`) !== d.defaultRoles.includes(r as never)) diffs.push(`${r} ${k}`);
    }
    expect(diffs.slice(0, 20)).toEqual([]);
  });

  it('rôle personnalisé : reçoit les clés de son rôle de base', async () => {
    await roleRepo.create({ code: customRole, label: `Caisse ${RUN}`, baseRole: 'cashier' }, admin);
    expect(await perms.permissionsOfRole(customRole)).toEqual(await perms.permissionsOfRole('cashier'));
  });

  it('exception utilisateur : l\'emporte sur les rôles', async () => {
    expect(await perms.hasPermission({ userId: admin }, 'production.confirm')).toBe(true);
    await p().query(`INSERT INTO user_action_permissions (user_id, permission_key, granted) VALUES ($1, 'production.confirm', false)`, [admin]);
    perms.invalidatePermissionCaches();
    expect(await perms.hasPermission({ userId: admin }, 'production.confirm')).toBe(false);
  });

  it('un retrait sur un rôle tient : l\'amorçage ne réécrit pas une clé amorcée', async () => {
    const keep = (await perms.permissionsOfRole('manager')).filter(k => k !== 'production.complete');
    await perms.setRolePermissions('manager', keep, admin);
    expect(await perms.seedPermissions()).toBe(0);
    expect(await perms.permissionsOfRole('manager')).not.toContain('production.complete');
  });
});
