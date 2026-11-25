import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PERMISSIONS } from '@ofauria/shared';
import { hasTestDb, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, type Fixtures } from './helpers.js';

const DEFS = PERMISSIONS as Record<string, { module: string }>;

describe.skipIf(!hasTestDb)('Assistant — modèles de rôles (lot 11, mig 690)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fx: Fixtures;
  beforeAll(async () => { repos = await importRepositories(); fx = await createBaseFixtures(); });
  afterAll(async () => { if (fx) await cleanupFixtures(fx); await repos?.db.pool.end(); await closeTestPool(); });

  it('le catalogue expose les modèles et leur état', async () => {
    const { wizardCatalog } = await import('../../services/wizard/catalog.js');
    const catalog = await wizardCatalog(false);
    const codes = catalog.roleTemplates.map(t => t.code);
    expect(codes).toEqual(expect.arrayContaining(['direction', 'comptable', 'controleur_qualite']));
    expect(catalog.roleTemplates.find(t => t.code === 'magasinier')?.exists).toBe(true);
    // Les modèles livrés respectent les règles de séparation des tâches livrées.
    expect(catalog.roleTemplates.filter(t => t.sod.some(v => v.severity === 'critical')).map(t => t.code)).toEqual([]);
  });

  it('crée les rôles absents avec des droits bornés, sans toucher aux rôles existants', async () => {
    const { withTransaction, db } = await import('../../config/database.js');
    const { applyRoleTemplates } = await import('../../services/wizard/role-templates.js');
    const { seedPermissions } = await import('../../services/permissions.js');
    const rollback = new Error('rollback test');
    await expect(withTransaction(async () => {
      await seedPermissions();
      const magasinierBefore = (await db.query(`SELECT module, can_view, can_create, can_edit, can_delete, config FROM role_permissions WHERE role_code='magasinier' ORDER BY module`)).rows;
      const managerKeys = new Set((await db.query(`SELECT permission_key FROM role_action_permissions WHERE role_code='manager'`)).rows.map(r => r.permission_key));
      const impact = await applyRoleTemplates({
        modules: { data: { selected: ['controle', 'production', 'stock'] } },
        roles: { data: { selected: ['controleur_qualite', 'magasinier', 'inconnu'] } },
      }, fx.userId);
      expect(impact).toEqual({ created: ['controleur_qualite'], skipped: ['magasinier'] });
      expect((await db.query(`SELECT base_role, is_system FROM roles WHERE code='controleur_qualite'`)).rows[0]).toEqual({ base_role: 'manager', is_system: false });
      const perms = (await db.query(`SELECT module, can_create, can_delete, config FROM role_permissions WHERE role_code='controleur_qualite' ORDER BY module`)).rows;
      expect(perms.map(p => p.module)).toEqual(['controle', 'production', 'stock']);
      expect(perms[0]).toMatchObject({ can_create: true, can_delete: false, config: { scope: 'all' } });
      const keys = (await db.query(`SELECT permission_key FROM role_action_permissions WHERE role_code='controleur_qualite'`)).rows.map(r => r.permission_key as string);
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.every(k => managerKeys.has(k))).toBe(true);
      expect(keys.every(k => ['controle', 'production', 'stock'].includes(DEFS[k]?.module))).toBe(true);
      expect(keys.filter(k => DEFS[k].module !== 'controle').every(k => k.endsWith('.view'))).toBe(true);
      expect((await db.query(`SELECT module, can_view, can_create, can_edit, can_delete, config FROM role_permissions WHERE role_code='magasinier' ORDER BY module`)).rows).toEqual(magasinierBefore);
      throw rollback;
    })).rejects.toBe(rollback);
  }, 60000);
});
