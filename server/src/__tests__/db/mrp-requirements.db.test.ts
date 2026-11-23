/**
 * G0-27 — calcul des besoins.
 *  - article à deux niveaux de semi-finis : les besoins du niveau 2 sont présents, calculés
 *    sur ce qu'il reste à produire du niveau 1 (après son stock) ;
 *  - une fiche archivée ne produit plus de besoins ;
 *  - génération des demandes d'achat relancée deux fois, ou lancée deux fois en même
 *    temps : aucune demande en double.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, cleanupFixtures, RUN, setComposition, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Calcul des besoins (G0-27)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let mrp: typeof import('../../repositories/mrp.repository.js')['mrpRepository'];
  let fx: Fixtures;
  let productId: string, recipeId: string, pateId: string, levainId: string, farineId: string;
  const p = () => testPool();
  const DATE = '2027-10-05';

  const recipe = async (name: string, isBase: boolean, product: string | null) => {
    const id = (await p().query(
      `INSERT INTO recipes (name, is_base, product_id, yield_quantity, yield_unit, mode_cout) VALUES ($1, $2, $3, 1, $4, 'ratio_poids') RETURNING id`,
      [`${name} ${RUN}`, isBase, product, isBase ? 'kg' : 'unit'])).rows[0].id as string;
    fx.ids.recipes.push(id);
    return id;
  };
  const requests = async () => (await p().query(
    `SELECT status FROM purchase_requests WHERE ingredient_id = $1 ORDER BY created_at`, [farineId])).rows.map(r => r.status);

  beforeAll(async () => {
    repos = await importRepositories();
    ({ mrpRepository: mrp } = await import('../../repositories/mrp.repository.js'));
    fx = await createBaseFixtures();
    farineId = await createIngredient(fx, { name: 'Farine G027', unit: 'kg', unitCost: 10 });
    productId = (await p().query(
      `INSERT INTO products (name, slug, price, sale_type, sale_unit) VALUES ($1, $2, 3, 'jour', 'unit') RETURNING id`,
      [`Pain G027 ${RUN}`, `pain-g027-${RUN}`])).rows[0].id;
    fx.ids.products.push(productId);
    // Pain (1 pièce) = 0,5 kg de Pâte ; Pâte (1 kg) = 0,2 kg de Levain ; Levain (1 kg) = farine.
    levainId = await recipe('Levain G027', true, null);
    pateId = await recipe('Pâte G027', true, null);
    recipeId = await recipe('Rec Pain G027', false, productId);
    await setComposition(levainId, { ingredients: [{ ingredientId: farineId, quantity: 1, unit: 'kg' }] });
    await setComposition(pateId, { subRecipes: [{ subRecipeId: levainId, quantity: 0.2 }] });
    await setComposition(recipeId, { subRecipes: [{ subRecipeId: pateId, quantity: 0.5 }] });
    // 2 kg de pâte déjà en stock.
    await p().query(`INSERT INTO semi_finished_stock (recipe_id, store_id, quantity_available, unit) VALUES ($1, $2, 2, 'kg')`, [pateId, fx.storeId]);
    // 10 pains à produire ce jour-là.
    vi.spyOn(mrp, 'netRequirements').mockResolvedValue(
      { rows: [{ product_id: productId, net_to_produce: 10 }] } as unknown as Awaited<ReturnType<typeof mrp.netRequirements>>);
  }, 60_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await p().query(`DELETE FROM purchase_requests WHERE ingredient_id = $1`, [farineId]).catch(() => undefined);
    await p().query(`DELETE FROM semi_finished_stock WHERE store_id = $1`, [fx.storeId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('deux niveaux de semi-finis : le niveau 2 est calculé sur le reste à produire du niveau 1', async () => {
    const { rows } = await mrp.semiFinishedNeeds(fx.storeId, DATE);
    expect(rows.map(r => ({ id: r.recipe_id, level: r.level, needed: r.needed, from_stock: r.from_stock, to_produce: r.to_produce }))).toEqual([
      { id: pateId, level: 1, needed: 5, from_stock: 2, to_produce: 3 },          // 10 pains × 0,5 kg, 2 kg en stock
      { id: levainId, level: 2, needed: 0.6, from_stock: 0, to_produce: 0.6 },    // 3 kg de pâte à faire × 0,2 kg
    ]);
  });

  it('une fiche archivée ne produit plus de besoins', async () => {
    await p().query(`UPDATE recipes SET archived_at = now() WHERE id = $1`, [recipeId]);
    try {
      expect((await mrp.semiFinishedNeeds(fx.storeId, DATE)).rows).toEqual([]);
    } finally {
      await p().query(`UPDATE recipes SET archived_at = NULL WHERE id = $1`, [recipeId]);
    }
  });

  it('demandes d\'achat : deux générations simultanées puis une troisième, une seule demande', async () => {
    vi.spyOn(mrp, 'materialRequirements').mockResolvedValue({
      store_id: fx.storeId, date: DATE, totals: { ingredients: 1, to_order: 1, estimated_cost: 30 },
      rows: [{ ingredient_id: farineId, ingredient_name: 'Farine G027', unit: 'kg', needed: 3, on_hand: 0, seuil: 0, shortage: 3, unit_cost: 10, estimated_cost: 30 }],
    });
    const [a, b] = await Promise.all([
      mrp.generatePurchaseRequests(fx.storeId, DATE, fx.userId),
      mrp.generatePurchaseRequests(fx.storeId, DATE, fx.userId),
    ]);
    expect(a.created + b.created).toBe(1);
    expect(a.skipped_existing + b.skipped_existing).toBe(1);
    expect(await mrp.generatePurchaseRequests(fx.storeId, DATE, fx.userId)).toMatchObject({ created: 0, skipped_existing: 1 });
    expect(await requests()).toHaveLength(1);
  }, 60_000);

  it('une demande déjà affectée ou commandée compte comme ouverte : pas de nouvelle demande', async () => {
    for (const status of ['assigned', 'ordered']) {
      await p().query(`UPDATE purchase_requests SET status = $2 WHERE ingredient_id = $1`, [farineId, status]);
      expect(await mrp.generatePurchaseRequests(fx.storeId, DATE, fx.userId)).toMatchObject({ created: 0, skipped_existing: 1 });
    }
    expect(await requests()).toEqual(['ordered']);
  }, 60_000);
});
