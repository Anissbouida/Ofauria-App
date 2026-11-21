/**
 * Scénario 1, constat 128 — suppression d'une matière :
 *  - employée dans une fiche (composition par format) : refus nommant les fiches ;
 *  - déjà commandée / reçue / facturée : refus (l'historique serait effacé) ;
 *  - sans fiche ni historique : supprimée.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Suppression d\'une matière : gardes (constat 128)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let ing: typeof import('../../repositories/inventory.repository.js')['ingredientRepository'];
  let pos: typeof import('../../repositories/purchase-order.repository.js').purchaseOrderRepository;
  let fx: Fixtures;
  let usedId = '', boughtId = '', freeId = '', recipeId = '', formatId = '', supplierId = '', poId = '';
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    ing = (await import('../../repositories/inventory.repository.js')).ingredientRepository;
    pos = (await import('../../repositories/purchase-order.repository.js')).purchaseOrderRepository;
    fx = await createBaseFixtures();
    usedId = await createIngredient(fx, { name: 'Farine C128', unit: 'kg', unitCost: 5.5 });
    boughtId = await createIngredient(fx, { name: 'Sucre C128', unit: 'kg', unitCost: 5 });
    freeId = (await p().query(`INSERT INTO ingredients (name, unit, unit_cost, category) VALUES ($1, 'kg', 1, 'autre') RETURNING id`, [`Libre C128 ${RUN}`])).rows[0].id;
    recipeId = (await p().query(`INSERT INTO recipes (name) VALUES ($1) RETURNING id`, [`Pain C128 ${RUN}`])).rows[0].id;
    formatId = (await p().query(`INSERT INTO recipe_formats (recipe_id, quantite_par_format) VALUES ($1, 1000) RETURNING id`, [recipeId])).rows[0].id;
    await p().query(`INSERT INTO recipe_format_components (format_id, source_ingredient_id, quantite, unite, ordre) VALUES ($1, $2, 10, 'kg', 0)`, [formatId, usedId]);
    supplierId = (await p().query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`Fournisseur C128 ${RUN}`])).rows[0].id;
    poId = ((await pos.create({ supplierId, createdBy: fx.userId, storeId: fx.storeId,
      items: [{ ingredientId: boughtId, quantityOrdered: 10, unitPrice: 5 }] } as never)) as { id: string }).id;
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM purchase_order_items WHERE purchase_order_id = $1`, [poId]).catch(() => undefined);
    await p().query(`DELETE FROM purchase_orders WHERE id = $1`, [poId]).catch(() => undefined);
    await p().query(`DELETE FROM suppliers WHERE id = $1`, [supplierId]).catch(() => undefined);
    await p().query(`DELETE FROM recipe_format_components WHERE format_id = $1`, [formatId]).catch(() => undefined);
    await p().query(`DELETE FROM recipe_formats WHERE id = $1`, [formatId]).catch(() => undefined);
    await p().query(`DELETE FROM recipes WHERE id = $1`, [recipeId]).catch(() => undefined);
    await p().query(`DELETE FROM ingredients WHERE id = $1`, [freeId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('employée dans une fiche : refus nommant la fiche', async () => {
    const r = await ing.delete(usedId, { force: true });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toContain(`Pain C128 ${RUN}`);
    expect((await p().query(`SELECT 1 FROM ingredients WHERE id = $1`, [usedId])).rowCount).toBe(1);
  });

  it('déjà commandée : refus, la ligne de commande est conservée', async () => {
    const r = await ing.delete(boughtId, { force: true });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/déjà été achetée/);
    expect((await p().query(`SELECT 1 FROM purchase_order_items WHERE ingredient_id = $1`, [boughtId])).rowCount).toBe(1);
  });

  it('sans fiche ni historique : supprimée', async () => {
    const r = await ing.delete(freeId, { force: true });
    expect(r.ok).toBe(true);
    expect((await p().query(`SELECT 1 FROM ingredients WHERE id = $1`, [freeId])).rowCount).toBe(0);
  });
});
