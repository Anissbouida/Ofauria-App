/**
 * G5-03 — classes ABC et inventaire tournant (mig 551).
 * Quatre articles d'un magasin neuf consomment 800, 150, 40 et 10 DH sur l'année :
 *  - classes A, B, C, C (80 % / 95 %) ;
 *  - jamais comptés, ils sont tous dus : la campagne tournante les reprend, A en tête ;
 *  - un article compté dans un inventaire validé n'est plus dû avant la fréquence de sa classe.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, createLot, cleanupFixtures, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Classes ABC et inventaire tournant (G5-03)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let abc: typeof import('../../repositories/abc-cycle-count.repository.js')['abcCycleCountRepository'];
  let fx: Fixtures; let countId: string | undefined;
  const ids: Record<string, string> = {};
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    abc = (await import('../../repositories/abc-cycle-count.repository.js')).abcCycleCountRepository;
    fx = await createBaseFixtures();
    for (const [name, qty] of [['X', 80], ['Y', 15], ['Z', 4], ['W', 1]] as const) {
      ids[name] = await createIngredient(fx, { name: `Article ${name} G503`, unit: 'kg', unitCost: 10 });
      await createLot(fx, { ingredientId: ids[name], lotNumber: `G503${name}`, pesage: 5, expiresInDays: 60, unitCost: 10 });
      await p().query(`INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, store_id, created_at)
                       VALUES ($1, 'production', $2, $3, now() - interval '20 days')`, [ids[name], -qty, fx.storeId]);
    }
  }, 60_000);

  afterAll(async () => {
    if (countId) {
      await p().query(`DELETE FROM stock_count_lines WHERE count_id = $1`, [countId]).catch(() => undefined);
      await p().query(`DELETE FROM stock_counts WHERE id = $1`, [countId]).catch(() => undefined);
    }
    await p().query(`DELETE FROM inventory_transactions WHERE ingredient_id = ANY($1::uuid[])`, [Object.values(ids)]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('classement 80 / 95 % : A, B, C, C', async () => {
    expect(await abc.classify(fx.storeId)).toEqual({ A: 1, B: 1, C: 2 });
    const board = await abc.board(fx.storeId);
    const cls = Object.fromEntries(board.rows.map(r => [r.ingredient_id, r.abc_class]));
    expect([cls[ids.X], cls[ids.Y], cls[ids.Z], cls[ids.W]]).toEqual(['A', 'B', 'C', 'C']);
    expect(board.classes.find(c => c.class === 'A')).toMatchObject({ items: 1, due: 1, value: 800 });
  });

  it('campagne tournante : les articles dus, A en tête, campagne partielle', async () => {
    const r = await abc.generate(fx.storeId, fx.userId);
    if ('error' in r) throw new Error(r.error);
    countId = r.data!.id;
    expect(r.data!.title).toBe('Inventaire tournant — A 1 · B 1 · C 2');
    expect(r.data!.scope).toBe('partial');
    expect(r.data!.lines.map((l: { ingredient_id: string }) => l.ingredient_id).sort()).toEqual(Object.values(ids).sort());
  });

  it('un article compté et validé n\'est plus dû', async () => {
    const line = (await p().query(`SELECT id FROM stock_count_lines WHERE count_id = $1 AND ingredient_id = $2`, [countId, ids.X])).rows[0].id;
    const { stockCountRepository } = await import('../../repositories/stock-count.repository.js');
    await stockCountRepository.count(countId!, line, { countedQty: 5, userId: fx.userId });
    await p().query(`UPDATE stock_counts SET status = 'validated', count_date = CURRENT_DATE WHERE id = $1`, [countId]);
    const board = await abc.board(fx.storeId);
    expect(board.rows.find(r => r.ingredient_id === ids.X)!.due).toBe(false);
    expect(board.rows.find(r => r.ingredient_id === ids.Y)!.due).toBe(true);
  });
});
