/**
 * F-045 — Reconciliation vitrine <-> lots.
 *
 * Les retours recreditaient product_store_stock.vitrine_quantity sans recrediter
 * de lot, les echanges le decrementaient sans decrementer de lot : derive (ex.
 * vitrine affichee 72, lots 52) -> le POS affiche du stock invendable (vente
 * refusee faute de lot actif). reconcileVitrineToLots aligne la vitrine sur la
 * somme des lots. DRY-RUN par defaut (ne mute rien) ; apply trace l'ajustement.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, cleanupFixtures, RUN, type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Reconciliation vitrine <-> lots (F-045)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let productLotRepository: typeof import('../../repositories/product-lot.repository.js').productLotRepository;
  let fx: Fixtures;
  let productId: string;

  beforeAll(async () => {
    repos = await importRepositories();
    productLotRepository = (await import('../../repositories/product-lot.repository.js')).productLotRepository;
    fx = await createBaseFixtures();
    const p = testPool();
    const prod = await p.query(
      `INSERT INTO products (name, slug, price, sale_type, sale_unit)
       VALUES ($1, $2, 6, 'jour', 'unit') RETURNING id`,
      [`Muffin f045 ${RUN}`, `muffin-f045-${RUN}`]
    );
    productId = prod.rows[0].id;
    // Vitrine affichee = 72, mais lots ne totalisent que 52 (40 + 12) : derive de 20.
    await p.query(
      `INSERT INTO product_store_stock (product_id, store_id, stock_quantity, stock_min_threshold, vitrine_quantity)
       VALUES ($1, $2, 0, 0, 72)`,
      [productId, fx.storeId]
    );
    for (const [n, qty] of [['A', 40], ['B', 12]] as const) {
      await p.query(
        `INSERT INTO product_lots
           (product_id, store_id, lot_number, quantity_total, vitrine_qty, backroom_qty, produced_at, expires_at, status)
         VALUES ($1, $2, $3, $4, $4, 0, NOW(), CURRENT_DATE + 1, 'active')`,
        [productId, fx.storeId, `PF045-${n}-${RUN}`, qty]
      );
    }
  }, 60_000);

  afterAll(async () => {
    const p = testPool();
    await p.query(`DELETE FROM product_stock_transactions WHERE product_id = $1`, [productId]).catch(() => undefined);
    await p.query(`DELETE FROM product_lots WHERE product_id = $1`, [productId]).catch(() => undefined);
    await p.query(`DELETE FROM product_store_stock WHERE product_id = $1`, [productId]).catch(() => undefined);
    await p.query(`DELETE FROM products WHERE id = $1`, [productId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('dry-run : rapporte la derive (72 -> 52) sans rien muter', async () => {
    const report = await productLotRepository.reconcileVitrineToLots(fx.storeId, false);
    expect(report.applied).toBe(false);
    const mine = report.drifts.find((d) => d.productId === productId);
    expect(mine).toBeDefined();
    expect(mine!.displayQty).toBeCloseTo(72, 3);
    expect(mine!.lotQty).toBeCloseTo(52, 3);
    expect(mine!.delta).toBeCloseTo(-20, 3);

    // Rien n'a bouge.
    const stock = await testPool().query(
      `SELECT vitrine_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`,
      [productId, fx.storeId]
    );
    expect(parseFloat(stock.rows[0].vitrine_quantity)).toBeCloseTo(72, 3);
  });

  it('apply : aligne la vitrine sur les lots (52) et trace l ajustement', async () => {
    const res = await productLotRepository.reconcileVitrineToLots(fx.storeId, true);
    expect(res.applied).toBe(true);

    const stock = await testPool().query(
      `SELECT vitrine_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`,
      [productId, fx.storeId]
    );
    expect(parseFloat(stock.rows[0].vitrine_quantity)).toBeCloseTo(52, 3);

    const txn = await testPool().query(
      `SELECT quantity_change, note FROM product_stock_transactions
        WHERE product_id = $1 AND type = 'adjustment' AND note ILIKE '%Reconciliation vitrine%'`,
      [productId]
    );
    expect(txn.rows).toHaveLength(1);
    expect(parseFloat(txn.rows[0].quantity_change)).toBeCloseTo(-20, 3);

    // Idempotent : plus de derive apres alignement.
    const after = await productLotRepository.reconcileVitrineToLots(fx.storeId, false);
    expect(after.drifts.find((d) => d.productId === productId)).toBeUndefined();
  });
});
