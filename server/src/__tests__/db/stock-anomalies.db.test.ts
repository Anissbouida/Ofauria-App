/**
 * G0-18 — sortie de stock supérieure au disponible.
 * Sortie de 10 sur un stock de 6 :
 *  - mode « autoriser et tracer » : stock à 0 et anomalie de 4 ;
 *  - mode « bloquer » : erreur, stock intact, aucune anomalie ;
 *  - mise au rebut d'un lot : jamais refusée, toujours tracée ;
 *  - une anomalie se clôt avec un motif.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Sorties supérieures au stock (G0-18)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let stock: typeof import('../../repositories/product-stock.helper.js');
  let anomalies: typeof import('../../services/stock-anomaly.js');
  let fx: Fixtures;
  let productId: string;
  let previous: unknown;
  const p = () => testPool();

  const setPolicy = (product: 'allow_trace' | 'block') => p().query(
    `INSERT INTO module_parameters (key, value) VALUES ('stock.negative_policy', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify({ ingredient: 'allow_trace', product, packaging: 'allow_trace', semi_finished: 'allow_trace' })]);
  const setStock = (backroom: number, vitrine = 0) => p().query(
    `INSERT INTO product_store_stock (product_id, store_id, stock_quantity, vitrine_quantity) VALUES ($1, $2, $3, $4)
     ON CONFLICT (product_id, store_id) DO UPDATE SET stock_quantity = $3, vitrine_quantity = $4`, [productId, fx.storeId, backroom, vitrine]);
  const stockOf = async () => (await p().query(
    `SELECT stock_quantity::float8 AS s, vitrine_quantity::float8 AS v FROM product_store_stock WHERE product_id = $1 AND store_id = $2`,
    [productId, fx.storeId])).rows[0];
  const open = async () => (await anomalies.stockAnomalyRepository.list({ status: 'open', storeId: fx.storeId }))
    .filter((a: { item_id: string }) => a.item_id === productId);
  /** Sortie dans une transaction, comme le font les appelants réels. */
  const inTx = async <T>(fn: (c: import('pg').PoolClient) => Promise<T>) => {
    const c = await repos.db.getClient();
    try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
    catch (e) { await c.query('ROLLBACK'); throw e; }
    finally { c.release(); }
  };

  beforeAll(async () => {
    repos = await importRepositories();
    stock = await import('../../repositories/product-stock.helper.js');
    anomalies = await import('../../services/stock-anomaly.js');
    fx = await createBaseFixtures();
    previous = (await p().query(`SELECT value FROM module_parameters WHERE key = 'stock.negative_policy'`)).rows[0]?.value;
    productId = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1, $2, 3) RETURNING id`, [`Pain G018 ${RUN}`, `pain-g018-${RUN}`])).rows[0].id;
    fx.ids.products.push(productId);
  }, 60_000);

  afterAll(async () => {
    if (previous) await p().query(`UPDATE module_parameters SET value = $1::jsonb WHERE key = 'stock.negative_policy'`, [JSON.stringify(previous)]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('autoriser et tracer : stock à 0 et anomalie du manque', async () => {
    await setPolicy('allow_trace');
    await setStock(6);
    const after = await inTx(c => stock.adjustProductStock(c, productId, -10, fx.storeId,
      { origin: { type: 'test_sortie' }, userId: fx.userId, label: 'Pain G018' }));
    expect(after).toBe(0);
    const list = await open();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ item_kind: 'product', requested_qty: 10, available_qty: 6, shortfall_qty: 4, origin_type: 'test_sortie', status: 'open' });
    expect(list[0].item_name).toContain('Pain G018');
  });

  it('une sortie couverte par le stock ne crée rien', async () => {
    await setStock(6);
    expect(await inTx(c => stock.adjustProductStock(c, productId, -6, fx.storeId))).toBe(0);
    expect(await open()).toHaveLength(1);
  });

  it('bloquer : la sortie est refusée, le stock ne bouge pas', async () => {
    await setPolicy('block');
    await setStock(6);
    await expect(inTx(c => stock.adjustProductStock(c, productId, -10, fx.storeId))).rejects.toMatchObject({ statusCode: 409 });
    expect((await stockOf()).s).toBe(6);
    expect(await open()).toHaveLength(1);
  });

  it('mise au rebut d\'un lot : jamais refusée, manque tracé même en mode bloquant', async () => {
    await setPolicy('block');
    await setStock(2, 1);
    await inTx(c => stock.removeFromStoreStock(c, { productId, storeId: fx.storeId, backroom: 5, vitrine: 1,
      origin: { type: 'lot_disposal' }, userId: fx.userId, label: 'Pain G018 — lot test' }));
    expect(await stockOf()).toEqual({ s: 0, v: 0 });
    const list = await open();
    expect(list).toHaveLength(2);
    expect(list.find((a: { origin_type: string }) => a.origin_type === 'lot_disposal'))
      .toMatchObject({ requested_qty: 6, available_qty: 3, shortfall_qty: 3 });
  });

  it('une anomalie se clôt avec un motif, une seule fois', async () => {
    const [first] = await open();
    await anomalies.stockAnomalyRepository.resolve(first.id, 'Inventaire refait, écart confirmé', fx.userId);
    expect(await open()).toHaveLength(1);
    await expect(anomalies.stockAnomalyRepository.resolve(first.id, 'Encore', fx.userId)).rejects.toMatchObject({ statusCode: 404 });
  });
});
