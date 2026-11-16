/**
 * G1-10 — tâche planifiée « péremption des lots de produits ».
 * Un lot dont la DLC est passée sort du stock du magasin, sa perte est enregistrée et il
 * passe à « périmé » ; un lot encore valide n'est pas touché ; relancer ne refait rien.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

const num = (v: unknown) => parseFloat(String(v));

describe.skipIf(!hasTestDb)('Tâche planifiée : péremption des lots (G1-10)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let scheduler: typeof import('../../services/scheduler.js');
  let fx: Fixtures;
  let productId: string, expiredLot: string, validLot: string;
  const p = () => testPool();
  const lot = async (id: string) => (await p().query(`SELECT status, backroom_qty::float8 AS b, vitrine_qty::float8 AS v FROM product_lots WHERE id = $1`, [id])).rows[0];
  const stock = async () => (await p().query(
    `SELECT stock_quantity::float8 AS s, vitrine_quantity::float8 AS v FROM product_store_stock WHERE product_id = $1 AND store_id = $2`, [productId, fx.storeId])).rows[0];
  const losses = async () => (await p().query(
    `SELECT quantity::float8 AS q, loss_type, source_product_lot_id FROM product_losses WHERE product_id = $1`, [productId])).rows;

  beforeAll(async () => {
    repos = await importRepositories();
    scheduler = await import('../../services/scheduler.js');
    fx = await createBaseFixtures();
    productId = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1, $2, 3) RETURNING id`, [`Pain G110 ${RUN}`, `pain-g110-${RUN}`])).rows[0].id;
    fx.ids.products.push(productId);
    const mk = async (tag: string, expires: string, backroom: number, vitrine: number) => (await p().query(
      `INSERT INTO product_lots (product_id, store_id, lot_number, quantity_total, backroom_qty, vitrine_qty, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE + $7::int) RETURNING id`,
      [productId, fx.storeId, `G110-${tag}-${RUN}`, backroom + vitrine, backroom, vitrine, expires])).rows[0].id as string;
    expiredLot = await mk('PERIME', '-1', 4, 2);     // DLC hier : 4 en réserve, 2 en vitrine
    validLot = await mk('VALIDE', '5', 3, 1);        // DLC dans 5 jours
    await p().query(`INSERT INTO product_store_stock (product_id, store_id, stock_quantity, vitrine_quantity) VALUES ($1, $2, 7, 3)`, [productId, fx.storeId]);
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM product_losses WHERE product_id = $1`, [productId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('la tâche est enregistrée, toutes les 15 minutes, désactivée à la livraison', async () => {
    expect((await p().query(`SELECT enabled, interval_minutes, domain FROM scheduled_jobs WHERE key = 'lots_expire'`)).rows[0])
      .toEqual({ enabled: false, interval_minutes: 15, domain: 'stock' });
  });

  it('le lot périmé sort du stock, la perte est tracée ; le lot valide ne bouge pas', async () => {
    const run = await scheduler.runJob('lots_expire', 'manual');
    expect(run.status).toBe('ok');
    expect(run.items).toBeGreaterThanOrEqual(1);
    expect((await lot(expiredLot)).status).not.toBe('active');
    expect(await lot(validLot)).toEqual({ status: 'active', b: 3, v: 1 });
    expect(await stock()).toEqual({ s: 3, v: 1 });                     // 7 − 4 en réserve, 3 − 2 en vitrine
    const l = await losses();
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ q: 6, loss_type: 'perime', source_product_lot_id: expiredLot });
  }, 120_000);

  it('relancer la tâche ne refait rien pour ce produit', async () => {
    await scheduler.runJob('lots_expire', 'manual');
    expect(await stock()).toEqual({ s: 3, v: 1 });
    expect(await losses()).toHaveLength(1);
    expect(num((await lot(validLot)).b)).toBe(3);
  }, 120_000);
});
