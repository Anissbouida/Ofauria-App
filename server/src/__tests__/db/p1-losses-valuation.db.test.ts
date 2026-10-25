/**
 * F-020 / F-062 — Valorisation des pertes au cout MATIERES reel.
 *
 * Avant : les pertes (production F-020, perime/DLC F-062) etaient valorisees
 * avec products.cost_price (= 0 sur tout le catalogue) ou le prix de vente,
 * donc 0,00 DH ou surevaluees. Le registre des pertes et le prime cost
 * sous-evaluaient tout.
 *
 * Apres : un helper unique (product-cost.helper) prend le cout matieres du
 * produit via v_product_unit_cost (recette/plan, SANS main-d'oeuvre ni frais
 * indirects), cost_price en dernier filet. Tous les sites d'ecriture de perte
 * l'utilisent.
 *
 * Macaron : 1 ingredient (0,5 kg x 8 DH/kg) => cout matieres unitaire = 4 DH,
 * alors que cost_price = 0 et prix de vente = 2.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createProductWithRecipe, cleanupFixtures,
  num, RUN, type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Pertes — valorisation au cout matieres (F-020/F-062)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let productCostHelper: typeof import('../../repositories/product-cost.helper.js');
  let productLotRepository: typeof import('../../repositories/product-lot.repository.js').productLotRepository;
  let fx: Fixtures;
  let productId: string;

  beforeAll(async () => {
    repos = await importRepositories();
    productCostHelper = await import('../../repositories/product-cost.helper.js');
    productLotRepository = (await import('../../repositories/product-lot.repository.js')).productLotRepository;
    fx = await createBaseFixtures();
    const sucreId = await createIngredient(fx, { name: 'Sucre', unit: 'kg', unitCost: 8 });
    const pr = await createProductWithRecipe(fx, {
      name: 'Macaron valo', price: 2, shelfLifeDays: null,       // prix de vente 2, cost_price 0
      ingredients: [{ ingredientId: sucreId, quantity: 0.5, unit: 'kg' }],
    });
    productId = pr.productId;
  }, 60_000);

  afterAll(async () => {
    if (fx) {
      await testPool().query(`DELETE FROM product_losses WHERE store_id = $1`, [fx.storeId]).catch(() => undefined);
      await cleanupFixtures(fx);
    }
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('v_product_unit_cost expose le cout MATIERES (0,5 x 8 = 4), pas 0 ni le prix de vente', async () => {
    const r = await testPool().query(
      `SELECT unit_cost, cost_source FROM v_product_unit_cost WHERE product_id = $1`, [productId]
    );
    expect(num(r.rows[0]?.unit_cost)).toBeCloseTo(4, 3);
    // La source est la recette (pas la fiche produit a 0, pas le prix).
    expect(r.rows[0]?.cost_source).toBe('recette');
  });

  it('le helper renvoie le cout matieres, filet cost_price, jamais le prix de vente', async () => {
    const cost = await productCostHelper.productMaterialsUnitCost(testPool(), productId);
    expect(cost).toBeCloseTo(4, 3);
    // Produit inconnu => 0 (cout manquant signale), pas d'erreur.
    const none = await productCostHelper.productMaterialsUnitCost(testPool(), '00000000-0000-0000-0000-000000000000');
    expect(none).toBe(0);
  });

  it('sendToLosses (perime/DLC, F-062) valorise la perte au cout matieres, pas 0', async () => {
    // Lot produit fini : 5 u en reserve, DLC passee.
    const lot = await testPool().query(
      `INSERT INTO product_lots
         (product_id, store_id, lot_number, quantity_total, backroom_qty, vitrine_qty,
          produced_at, expires_at, status)
       VALUES ($1, $2, $3, 5, 5, 0, NOW(), CURRENT_DATE - 1, 'active') RETURNING id`,
      [productId, fx.storeId, `PF-VALO-${RUN}`]
    );
    const lotId = lot.rows[0].id as string;

    const res = await productLotRepository.sendToLosses(lotId, 'dlc_expired', fx.userId, 'Test valorisation');
    // 5 u x 4 DH = 20 DH (et surtout : non nul).
    expect(num(res.lostQuantity)).toBeCloseTo(5, 3);
    expect(num(res.lostValue)).toBeCloseTo(20, 2);

    const loss = await testPool().query(
      `SELECT unit_cost, total_cost, loss_type FROM product_losses WHERE source_product_lot_id = $1`, [lotId]
    );
    expect(loss.rows).toHaveLength(1);
    expect(num(loss.rows[0].unit_cost)).toBeCloseTo(4, 3);
    expect(num(loss.rows[0].total_cost)).toBeCloseTo(20, 2);
    expect(num(loss.rows[0].unit_cost)).toBeGreaterThan(0);  // le bug : valait 0
    expect(loss.rows[0].loss_type).toBe('perime');
  });
});
