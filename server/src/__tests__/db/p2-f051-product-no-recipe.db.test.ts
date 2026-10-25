/**
 * F-051 — Creation d'un produit SANS recette (revente / negoce).
 *
 * Avant : productController.create refusait (400) tout produit sans recipeId
 * (« Une recette est obligatoire »). Impossible de creer une boisson revendue
 * ou un produit a fiche ulterieure. Desormais la recette est optionnelle ;
 * fournie, elle est validee et liee comme avant.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, cleanupFixtures, RUN, type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Produit sans recette (F-051)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let productController: typeof import('../../controllers/product.controller.js').productController;
  let fx: Fixtures;
  let createdId: string | null = null;

  beforeAll(async () => {
    repos = await importRepositories();
    productController = (await import('../../controllers/product.controller.js')).productController;
    fx = await createBaseFixtures();
  }, 60_000);

  afterAll(async () => {
    if (createdId) await testPool().query(`DELETE FROM products WHERE id = $1`, [createdId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('cree un produit de revente sans recipeId (201) et sans recette liee', async () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const json = vi.fn();
    const res: any = { status: vi.fn(() => ({ json })), json };
    const req: any = {
      body: { name: `Soda revente ${RUN}`, price: 10, saleType: 'jour', saleUnit: 'unit', isAvailable: true },
      user: { userId: fx.userId, storeId: fx.storeId },
    };
    await productController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    const payload = json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    createdId = payload.data.id;
    expect(createdId).toBeTruthy();

    // Produit bien en base, aucune recette liee.
    const prod = await testPool().query(`SELECT id, price FROM products WHERE id = $1`, [createdId]);
    expect(prod.rows).toHaveLength(1);
    const linked = await testPool().query(`SELECT id FROM recipes WHERE product_id = $1`, [createdId]);
    expect(linked.rows).toHaveLength(0);
  });
});
