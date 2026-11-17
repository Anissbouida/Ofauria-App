/**
 * G5-02 — point de commande et stock de sécurité (mig 550).
 * Un article consomme 112 kg sur les 56 derniers jours (2 kg/jour) ; son fournisseur
 * préféré livre en 3 jours ; 1 jour de sécurité :
 *  - mode manuel (stock de sécurité saisi 1) : le recalcul PROPOSE 2 × 3 + 1 = 7 sans
 *    toucher au point de commande ; la validation l'applique ;
 *  - mode calculé : sécurité 2 × 1 = 2, point de commande 2 × 3 + 2 = 8, appliqué ;
 *  - « À commander » ramène au maximum de l'article.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, createLot, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Points de commande (G5-02)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let rp: typeof import('../../repositories/reorder-point.repository.js')['reorderPointRepository'];
  let fx: Fixtures; let ing: string; let inv: string; let supplier: string;
  const p = () => testPool();
  const row = async () => (await p().query(
    `SELECT minimum_threshold::float8 AS rp, safety_stock::float8 AS ss, proposed_reorder_point::float8 AS prp, avg_daily_usage::float8 AS avg
       FROM inventory WHERE id = $1`, [inv])).rows[0];

  beforeAll(async () => {
    repos = await importRepositories();
    rp = (await import('../../repositories/reorder-point.repository.js')).reorderPointRepository;
    fx = await createBaseFixtures();
    ing = await createIngredient(fx, { name: 'Beurre G502', unit: 'kg', unitCost: 80 });
    await createLot(fx, { ingredientId: ing, lotNumber: 'G502', pesage: 5, expiresInDays: 30, unitCost: 80 });
    inv = (await p().query(`SELECT id FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [ing, fx.storeId])).rows[0].id;
    await p().query(`UPDATE inventory SET minimum_threshold = 4, safety_stock = 1 WHERE id = $1`, [inv]);
    await p().query(`INSERT INTO inventory_transactions (ingredient_id, type, quantity_change, store_id, created_at)
                     VALUES ($1, 'production', -112, $2, now() - interval '10 days')`, [ing, fx.storeId]);
    supplier = (await p().query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`Laiterie G502 ${RUN}`])).rows[0].id;
    await p().query(`INSERT INTO supplier_items (supplier_id, purchasable_kind, purchasable_id, lead_time_days, is_preferred)
                     VALUES ($1, 'ingredient', $2, 3, true)`, [supplier, ing]);
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM supplier_items WHERE supplier_id = $1`, [supplier]).catch(() => undefined);
    await p().query(`DELETE FROM suppliers WHERE id = $1`, [supplier]).catch(() => undefined);
    await p().query(`DELETE FROM inventory_transactions WHERE ingredient_id = $1`, [ing]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('mode manuel : proposition 7, point de commande inchangé', async () => {
    await rp.recalculate(fx.storeId);
    expect(await row()).toMatchObject({ rp: 4, ss: 1, prp: 7, avg: 2 });
    const listed = (await rp.list(fx.storeId)).rows.find(r => r.id === inv)!;
    expect(listed).toMatchObject({ lead_days: 3, lead_from_supplier: true, live_reorder_point: 7 });
  });

  it('validation : la proposition devient le point de commande', async () => {
    expect(await rp.applyProposals([inv])).toBe(1);
    expect((await row()).rp).toBe(7);
  });

  it('mode calculé : sécurité 2, point de commande 8, appliqués au recalcul', async () => {
    await rp.update(inv, { mode: 'calcule' });
    await rp.recalculate(fx.storeId);
    expect(await row()).toMatchObject({ rp: 8, ss: 2 });
  });

  it('« À commander » ramène au maximum de l\'article', async () => {
    await rp.update(inv, { maxStock: 20 });
    const { toOrderRepository } = await import('../../repositories/to-order.repository.js');
    const board = await toOrderRepository.board(fx.storeId);
    const line = (board.rows as Array<Record<string, any>>).find(r => r.ingredient_id === ing);
    expect(line?.low_stock).toMatchObject({ current: 5, threshold: 8, suggested: 15 });
  });
});
