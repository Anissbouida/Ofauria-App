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

  it('les plans se filtrent sur plusieurs ateliers à la fois', async () => {
    const { productionRepository } = await import('../../repositories/production.repository.js');
    const r = await productionRepository.findAll({ targetRoles: ['baker', 'pastry_chef'], limit: 5, offset: 0 });
    for (const row of r.rows) expect(['baker', 'pastry_chef']).toContain(row.target_role);
    expect(r.rows.every(row => 'target_role_label' in row)).toBe(true);
  });
});
