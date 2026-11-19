/**
 * Ateliers de production paramétrables (mig 511, plan Production générique P2).
 * Reprise à l'identique des 4 ateliers (code = rôle chef), atelier d'une catégorie,
 * ateliers d'un utilisateur (par rôle ou nominativement), atelier par défaut, et un
 * nouvel atelier qui fonctionne sans toucher au code.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Ateliers de production', () => {
  let ws: typeof import('../../services/workshops.js');
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let categoryId = 0;
  const slug = `test-montage-${RUN}`;
  const userId = '00000000-0000-0000-0000-00000000a511';

  beforeAll(async () => {
    repos = await importRepositories();
    ws = await import('../../services/workshops.js');
    categoryId = (await testPool().query(
      `INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING id`, [`Montage ${RUN}`, slug])).rows[0].id;
  });

  afterAll(async () => {
    const p = testPool();
    await p.query(`DELETE FROM production_workshops WHERE code = 'montage_test'`).catch(() => undefined);
    await p.query(`DELETE FROM categories WHERE id = $1`, [categoryId]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('reprend les 4 ateliers avec le code de leur rôle, Boulangerie par défaut', async () => {
    const list = await ws.listWorkshops();
    expect(list.map(w => w.code)).toEqual(expect.arrayContaining(['baker', 'viennoiserie', 'pastry_chef', 'beldi_sale']));
    expect(await ws.defaultWorkshop()).toBe('baker');
    expect(await ws.workshopsOf({ userId, role: 'baker' })).toEqual(['baker']);
    expect(await ws.workshopsOf({ userId, role: 'cashier' })).toEqual([]);
    expect(await ws.workshopLabel(null)).toBe('Général');
  });

  it('un nouvel atelier reçoit ses catégories et ses membres sans toucher au code', async () => {
    expect(await ws.workshopForCategorySlug(slug)).toBeNull();
    await ws.saveWorkshop('montage_test', {
      label: 'Montage', workCenterId: null, isDefault: false, isActive: true, sortOrder: 50,
      categoryIds: [categoryId], memberRoles: ['manager'], memberUsers: [],
    });
    expect(await ws.workshopForCategorySlug(slug)).toBe('montage_test');
    expect(await ws.workshopsOf({ userId, role: 'manager' })).toEqual(['montage_test']);
    expect(await ws.workshopLabel('montage_test')).toBe('Montage');

    // Atelier désactivé : plus d'atelier pour la catégorie ni pour ses membres.
    await ws.saveWorkshop('montage_test', {
      label: 'Montage', workCenterId: null, isDefault: false, isActive: false, sortOrder: 50,
      categoryIds: [categoryId], memberRoles: ['manager'], memberUsers: [],
    });
    expect(await ws.workshopForCategorySlug(slug)).toBeNull();
    expect(await ws.workshopsOf({ userId, role: 'manager' })).toEqual([]);
  });

  // Scénario 0 : « Chef Beldi » et « Chef Salé » sont deux rôles créés à partir du même
  // rôle livré ; la session ne porte que ce rôle de base. Un atelier dont le membre est
  // le rôle créé doit reconnaître son titulaire, et le cumul donner les deux ateliers.
  it('un rôle créé, membre d\'un atelier, donne cet atelier — seul ou en cumul', async () => {
    const p = testPool();
    const roles = ['tst_chef_a', 'tst_chef_b'];
    const shops = ['tst_atelier_a', 'tst_atelier_b'];
    const clean = async () => {
      await p.query(`DELETE FROM production_workshops WHERE code = ANY($1)`, [shops]);
      await p.query(`DELETE FROM users WHERE email LIKE 'tst-atelier-%@kalum.test'`);
      await p.query(`DELETE FROM roles WHERE code = ANY($1)`, [roles]);
    };
    await clean();
    try {
      for (const code of roles) {
        await p.query(`INSERT INTO roles (code, label, base_role, is_system) VALUES ($1, $1, 'magasinier', false)`, [code]);
      }
      const mkUser = async (name: string, codes: string[]) => {
        const id = (await p.query(
          `INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1, 'x', 'Test', $2, $3) RETURNING id`,
          [`tst-atelier-${name}-${RUN}@kalum.test`, name, codes[0]])).rows[0].id as string;
        for (const [i, c] of codes.entries()) {
          await p.query(
            `INSERT INTO user_roles (user_id, role_code, is_primary) VALUES ($1, $2, $3)
             ON CONFLICT (user_id, role_code) DO UPDATE SET is_primary = EXCLUDED.is_primary`, [id, c, i === 0]);
        }
        return id;
      };
      const a = await mkUser('a', ['tst_chef_a']);
      const b = await mkUser('b', ['tst_chef_b']);
      const both = await mkUser('ab', ['tst_chef_a', 'tst_chef_b']);
      for (const [i, code] of shops.entries()) {
        await ws.saveWorkshop(code, {
          label: code, workCenterId: null, isDefault: false, isActive: true, sortOrder: 900 + i,
          categoryIds: [], memberRoles: [roles[i]], memberUsers: [],
        });
      }
      // Ce que la connexion met dans le jeton : le rôle de base, jamais le rôle créé.
      const session = (userId: string) => ({ userId, role: 'magasinier', baseRoles: ['magasinier'] });
      expect(await ws.workshopsOf(session(a))).toEqual(['tst_atelier_a']);
      expect(await ws.workshopsOf(session(b))).toEqual(['tst_atelier_b']);
      expect(await ws.workshopsOf(session(both))).toEqual(shops);
      // Un magasinier sans rôle créé n'entre dans aucun des deux ateliers.
      expect(await ws.workshopsOf(session(userId))).toEqual([]);
    } finally {
      await clean();
      ws.invalidateWorkshops();
    }
  });

  it('les plans se filtrent sur plusieurs ateliers à la fois', async () => {
    const { productionRepository } = await import('../../repositories/production.repository.js');
    const r = await productionRepository.findAll({ targetRoles: ['baker', 'pastry_chef'], limit: 5, offset: 0 });
    for (const row of r.rows) expect(['baker', 'pastry_chef']).toContain(row.target_role);
    expect(r.rows.every(row => 'target_role_label' in row)).toBe(true);
  });
});
