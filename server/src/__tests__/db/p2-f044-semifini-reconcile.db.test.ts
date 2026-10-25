/**
 * F-044 (partie sure) — Reconciliation des semi-finis stock <-> lots.
 *
 * semi_finished_stock.quantity_available doit refleter la somme des
 * semi_finished_lots.quantity_remaining actifs (les lots font foi). Des deltas
 * se sont accumules (ex. « Pate d'amande 28 kg sans aucun lot »).
 * reconcileSemiFinishedToLots aligne le stock agrege sur les lots, DRY-RUN par
 * defaut. Elle ne touche PAS a la logique de production (le double comptage
 * parent/enfant releve d'un choix de modele, laisse au gerant).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createProductWithRecipe, createIngredient, cleanupFixtures, RUN, type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Reconciliation semi-finis <-> lots (F-044)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let stockFrigoRepository: typeof import('../../repositories/stock-frigo.repository.js').stockFrigoRepository;
  let fx: Fixtures;
  let phantomRecipeId: string;   // stock sans lot
  let okRecipeId: string;        // stock = lots

  beforeAll(async () => {
    repos = await importRepositories();
    stockFrigoRepository = (await import('../../repositories/stock-frigo.repository.js')).stockFrigoRepository;
    fx = await createBaseFixtures();
    const ingId = await createIngredient(fx, { name: 'Amande f044', unit: 'kg', unitCost: 50 });
    const r1 = await createProductWithRecipe(fx, { name: 'Pate amande f044', price: 0, ingredients: [{ ingredientId: ingId, quantity: 1 }] });
    phantomRecipeId = r1.recipeId;
    const r2 = await createProductWithRecipe(fx, { name: 'Pate ok f044', price: 0, ingredients: [{ ingredientId: ingId, quantity: 1 }] });
    okRecipeId = r2.recipeId;

    const p = testPool();
    // Fantome : 28 kg agreges, AUCUN lot actif.
    await p.query(
      `INSERT INTO semi_finished_stock (recipe_id, store_id, quantity_available, unit) VALUES ($1, $2, 28, 'kg')`,
      [phantomRecipeId, fx.storeId]
    );
    // Coherent : 5 kg agreges = 1 lot actif de 5 kg.
    await p.query(
      `INSERT INTO semi_finished_stock (recipe_id, store_id, quantity_available, unit) VALUES ($1, $2, 5, 'kg')`,
      [okRecipeId, fx.storeId]
    );
    await p.query(
      `INSERT INTO semi_finished_lots (recipe_id, store_id, lot_number, quantity_produced, quantity_remaining, produced_at, status)
       VALUES ($1, $2, $3, 5, 5, NOW(), 'active')`,
      [okRecipeId, fx.storeId, `SF-${RUN}`]
    );
  }, 60_000);

  afterAll(async () => {
    const p = testPool();
    const ids = [phantomRecipeId, okRecipeId];
    await p.query(`DELETE FROM semi_finished_transactions WHERE recipe_id = ANY($1::uuid[])`, [ids]).catch(() => undefined);
    await p.query(`DELETE FROM semi_finished_lots WHERE recipe_id = ANY($1::uuid[])`, [ids]).catch(() => undefined);
    await p.query(`DELETE FROM semi_finished_stock WHERE recipe_id = ANY($1::uuid[])`, [ids]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('dry-run : rapporte le stock fantome (28 -> 0), ignore le coherent', async () => {
    const report = await stockFrigoRepository.reconcileSemiFinishedToLots(fx.storeId, false);
    expect(report.applied).toBe(false);
    const phantom = report.drifts.find((d) => d.recipeId === phantomRecipeId);
    expect(phantom).toBeDefined();
    expect(phantom!.stockQty).toBeCloseTo(28, 3);
    expect(phantom!.lotQty).toBeCloseTo(0, 3);
    expect(phantom!.delta).toBeCloseTo(-28, 3);
    // Le stock coherent (5 = 5) n'apparait pas.
    expect(report.drifts.find((d) => d.recipeId === okRecipeId)).toBeUndefined();

    // Rien mute.
    const s = await testPool().query(`SELECT quantity_available FROM semi_finished_stock WHERE recipe_id = $1`, [phantomRecipeId]);
    expect(parseFloat(s.rows[0].quantity_available)).toBeCloseTo(28, 3);
  });

  it('apply : aligne le fantome a 0, trace, et devient idempotent', async () => {
    const res = await stockFrigoRepository.reconcileSemiFinishedToLots(fx.storeId, true);
    expect(res.applied).toBe(true);

    const s = await testPool().query(`SELECT quantity_available FROM semi_finished_stock WHERE recipe_id = $1`, [phantomRecipeId]);
    expect(parseFloat(s.rows[0].quantity_available)).toBeCloseTo(0, 3);

    const txn = await testPool().query(
      `SELECT quantity_change FROM semi_finished_transactions
        WHERE recipe_id = $1 AND type = 'adjustment' AND notes ILIKE '%Reconciliation semi-finis%'`,
      [phantomRecipeId]
    );
    expect(txn.rows).toHaveLength(1);
    expect(parseFloat(txn.rows[0].quantity_change)).toBeCloseTo(-28, 3);

    const after = await stockFrigoRepository.reconcileSemiFinishedToLots(fx.storeId, false);
    expect(after.drifts.find((d) => d.recipeId === phantomRecipeId)).toBeUndefined();
  });
});
