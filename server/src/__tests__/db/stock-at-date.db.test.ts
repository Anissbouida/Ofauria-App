/**
 * G5-01 — stock matière à une date (mig 549).
 * Un article reçoit 10 il y a 5 jours, en sort 3 il y a 2 jours ; son coût passe de 10
 * à 12 aujourd'hui :
 *  - aujourd'hui : 7 au coût 12 (= stock courant) ; il y a 3 jours : 10 au coût 10 ;
 *    il y a 6 jours : 0 ;
 *  - son journal explique son stock (aucun écart) ; un stock modifié sans mouvement
 *    apparaît dans le contrôle ;
 *  - une fois le jour de clôture passé, un mouvement daté dans la période est refusé.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, createLot, cleanupFixtures, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Stock à la date (G5-01)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let stock: typeof import('../../repositories/stock-valuation.repository.js')['stockValuationRepository'];
  let fx: Fixtures; let ing: string; let lot: string; let closing: string | undefined;
  const p = () => testPool();
  /** Date locale (Casablanca) d'il y a n jours, AAAA-MM-JJ. */
  const dayAgo = (n: number) => new Date(Date.now() - n * 86400_000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Casablanca' });
  const lineAt = async (n: number) => (await stock.stockAt(dayAgo(n), fx.storeId)).lines.find(l => l.ingredient_id === ing);

  beforeAll(async () => {
    repos = await importRepositories();
    stock = (await import('../../repositories/stock-valuation.repository.js')).stockValuationRepository;
    fx = await createBaseFixtures();
    ing = await createIngredient(fx, { name: 'Sucre G501', unit: 'kg', unitCost: 10 });
    lot = await createLot(fx, { ingredientId: ing, lotNumber: 'G501', pesage: 10, expiresInDays: 60, unitCost: 10 });
    await p().query(`INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, store_id, ingredient_lot_id, created_at)
                     VALUES ($1, 'restock', 10, $2, $3, now() - interval '5 days')`, [ing, fx.storeId, lot]);
    await p().query(`UPDATE ingredient_lots SET pesage_quantity = 7, quantity_remaining = 7 WHERE id = $1`, [lot]);
    await p().query(`INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, store_id, ingredient_lot_id, created_at)
                     VALUES ($1, 'usage', -3, $2, $3, now() - interval '2 days')`, [ing, fx.storeId, lot]);
    await p().query(`UPDATE ingredients SET unit_cost = 12 WHERE id = $1`, [ing]);
  }, 60_000);

  afterAll(async () => {
    if (closing) await p().query(`DELETE FROM stock_closings WHERE id = $1`, [closing]).catch(() => undefined);
    await p().query(`DELETE FROM inventory_transactions WHERE ingredient_id = $1`, [ing]).catch(() => undefined);
    await p().query(`DELETE FROM purchasing_master_audit WHERE record_id = $1`, [ing]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('aujourd\'hui : le stock courant, au coût actuel', async () => {
    expect((await p().query(`SELECT current_quantity::float8 AS q FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [ing, fx.storeId])).rows[0].q).toBe(7);
    expect(await lineAt(0)).toMatchObject({ quantity: 7, unit_cost: 12, value: 84 });
  });

  it('il y a 3 jours : avant la sortie et avant le changement de coût', async () => {
    expect(await lineAt(3)).toMatchObject({ quantity: 10, unit_cost: 10, value: 100 });
  });

  it('il y a 6 jours : avant l\'entrée, plus rien', async () => {
    expect(await lineAt(6)).toBeUndefined(); // les lignes à zéro ne sont pas rendues
  });

  it('contrôle : journal complet pour l\'article, écart signalé dès qu\'un stock bouge sans mouvement', async () => {
    expect((await stock.journalGaps(fx.storeId)).find(g => g.ingredient_id === ing)).toBeUndefined();
    await p().query(`UPDATE ingredient_lots SET pesage_quantity = 6, quantity_remaining = 6 WHERE id = $1`, [lot]);
    expect((await stock.journalGaps(fx.storeId)).find(g => g.ingredient_id === ing)).toMatchObject({ gap: -1 });
    await p().query(`UPDATE ingredient_lots SET pesage_quantity = 7, quantity_remaining = 7 WHERE id = $1`, [lot]);
  });

  it('verrou : un mouvement daté dans une période close est refusé, l\'activité du jour passe', async () => {
    closing = (await p().query(
      `INSERT INTO stock_closings (period_label, closing_date, store_id, status) VALUES ('Test G501', $1::date, $2, 'closed') RETURNING id`,
      [dayAgo(4), fx.storeId])).rows[0].id;
    await expect(p().query(`INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, store_id, created_at)
                            VALUES ($1, 'adjustment', 1, $2, now() - interval '6 days')`, [ing, fx.storeId])).rejects.toThrow(/PERIODE_STOCK_CLOSE/);
    await expect(p().query(`INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, store_id)
                            VALUES ($1, 'adjustment', 0.0001, $2) RETURNING id`, [ing, fx.storeId])).resolves.toBeTruthy();
  });
});
