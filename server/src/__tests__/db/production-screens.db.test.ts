/**
 * Écrans de fabrication (mig 591) : masquer puis réafficher un élément, pour la société et pour un
 * type d'ordre ; élément indispensable ou inconnu refusé.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Écrans de fabrication (mig 591)', () => {
  let fx: Fixtures;
  let repo: typeof import('../../repositories/production-screens.repository.js')['productionScreensRepository'];
  let typeId = '';
  const p = () => testPool();

  beforeAll(async () => {
    await importRepositories();
    repo = (await import('../../repositories/production-screens.repository.js')).productionScreensRepository;
    fx = await createBaseFixtures();
    typeId = (await p().query(
      `INSERT INTO production_order_types (code, label, requires_bon_sortie, requires_weighing, consumption_mode)
       VALUES ($1, 'Test écrans', false, false, 'a_la_declaration') RETURNING id`, [`SCR_${RUN}`.slice(0, 30)])).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    const run = async (sql: string, params: unknown[]) => { try { await p().query(sql, params); } catch { /* best effort */ } };
    await run(`DELETE FROM production_screen_hidden WHERE updated_by = $1`, [fx.userId]);
    await run(`DELETE FROM production_order_types WHERE id = $1`, [typeId]);
    await run(`DELETE FROM users WHERE id = $1`, [fx.userId]);
    await run(`DELETE FROM stores WHERE id = $1`, [fx.storeId]);
    await closeTestPool();
  }, 60_000);

  it('masquer pour un type et pour la société, puis réafficher', async () => {
    let list = await repo.setHidden(typeId, 'yield', true, fx.userId);
    expect(list).toContainEqual({ orderTypeId: typeId, key: 'yield' });
    await repo.setHidden(typeId, 'yield', true, fx.userId); // idempotent
    list = await repo.setHidden(null, 'launch.losses', true, fx.userId);
    expect(list.filter(h => h.key === 'launch.losses' && h.orderTypeId === null)).toHaveLength(1);
    list = await repo.setHidden(typeId, 'yield', false, fx.userId);
    expect(list.some(h => h.orderTypeId === typeId && h.key === 'yield')).toBe(false);
    list = await repo.setHidden(null, 'launch.losses', false, fx.userId);
    expect(list.some(h => h.key === 'launch.losses' && h.orderTypeId === null)).toBe(false);
  });

  it('élément indispensable ou inconnu refusé', async () => {
    await expect(repo.setHidden(null, 'bon-sortie', true, fx.userId)).rejects.toThrow(/indispensable/);
    await expect(repo.setHidden(null, 'inexistant', true, fx.userId)).rejects.toThrow(/inconnu/);
  });
});
