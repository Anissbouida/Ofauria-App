/**
 * F-045/F-036 (prevention) — Retours et echanges maintiennent product_lots en
 * phase avec product_store_stock.vitrine_quantity.
 *
 * Avant : le retour ne recreditait que product_store_stock (pas de lot), l'echange
 * ne decrementait que product_store_stock pour le nouveau produit -> derive
 * vitrine vs lots (cause de F-045). Desormais :
 *   - le retour recredite le(s) lot(s) d'origine (sale_item_lots) ;
 *   - l'echange decremente un/des lot(s) FEFO du nouveau produit, comme une vente.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, cleanupFixtures, RUN, type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Retours/echanges : lots en phase (F-045/F-036)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let returnRepository: typeof import('../../repositories/return.repository.js').returnRepository;
  let fx: Fixtures;
  let P: string; let Lp: string; let S1: string; let SIp: string;   // retour
  let R: string; let Lr: string; let S2: string; let SIr: string;   // echange : produit rendu
  let Q: string; let Lq: string;                                     // echange : nouveau produit

  const makeProduct = async (slug: string, vitrine: number, sold: number): Promise<{ id: string; lotId: string }> => {
    const p = testPool();
    const prod = await p.query(
      `INSERT INTO products (name, slug, price, sale_type, sale_unit) VALUES ($1, $2, 6, 'jour', 'unit') RETURNING id`,
      [`${slug} ${RUN}`, `${slug}-${RUN}`]
    );
    const id = prod.rows[0].id;
    await p.query(
      `INSERT INTO product_store_stock (product_id, store_id, stock_quantity, stock_min_threshold, vitrine_quantity)
       VALUES ($1, $2, 0, 0, $3)`,
      [id, fx.storeId, vitrine]
    );
    const lot = await p.query(
      `INSERT INTO product_lots (product_id, store_id, lot_number, quantity_total, vitrine_qty, backroom_qty, sold_qty, produced_at, expires_at, status)
       VALUES ($1, $2, $3, $4, $5, 0, $6, NOW(), CURRENT_DATE + 1, 'active') RETURNING id`,
      [id, fx.storeId, `L-${slug}-${RUN}`, vitrine + sold, vitrine, sold]
    );
    return { id, lotId: lot.rows[0].id };
  };

  const makeSaleItem = async (productId: string, lotId: string): Promise<{ saleId: string; saleItemId: string }> => {
    const p = testPool();
    const sale = await p.query(
      `INSERT INTO sales (sale_number, user_id, store_id, subtotal, total, payment_method)
       VALUES ($1, $2, $3, 6, 6, 'cash') RETURNING id`,
      [`RT${RUN}${Math.floor(Math.random() * 90 + 10)}`.slice(0, 20), fx.userId, fx.storeId]
    );
    const si = await p.query(
      `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES ($1, $2, 1, 6, 6) RETURNING id`,
      [sale.rows[0].id, productId]
    );
    await p.query(
      `INSERT INTO sale_item_lots (sale_item_id, product_lot_id, quantity) VALUES ($1, $2, 1)`,
      [si.rows[0].id, lotId]
    );
    return { saleId: sale.rows[0].id, saleItemId: si.rows[0].id };
  };

  beforeAll(async () => {
    repos = await importRepositories();
    returnRepository = (await import('../../repositories/return.repository.js')).returnRepository;
    fx = await createBaseFixtures();
    ({ id: P, lotId: Lp } = await makeProduct('ret', 4, 1));
    ({ saleId: S1, saleItemId: SIp } = await makeSaleItem(P, Lp));
    ({ id: R, lotId: Lr } = await makeProduct('exret', 2, 1));
    ({ saleId: S2, saleItemId: SIr } = await makeSaleItem(R, Lr));
    ({ id: Q, lotId: Lq } = await makeProduct('exnew', 3, 0));
  }, 60_000);

  afterAll(async () => {
    const p = testPool();
    const prods = [P, R, Q];
    await p.query(`DELETE FROM sale_item_lots WHERE product_lot_id = ANY($1::uuid[])`, [[Lp, Lr, Lq]]).catch(() => undefined);
    await p.query(`DELETE FROM sale_return_items WHERE product_id = ANY($1::uuid[])`, [prods]).catch(() => undefined);
    await p.query(`DELETE FROM sale_returns WHERE store_id = $1`, [fx.storeId]).catch(() => undefined);
    await p.query(`DELETE FROM sale_items WHERE product_id = ANY($1::uuid[])`, [prods]).catch(() => undefined);
    await p.query(`DELETE FROM sales WHERE store_id = $1`, [fx.storeId]).catch(() => undefined);
    await p.query(`DELETE FROM product_lot_movements WHERE product_lot_id = ANY($1::uuid[])`, [[Lp, Lr, Lq]]).catch(() => undefined);
    await p.query(`DELETE FROM product_stock_transactions WHERE product_id = ANY($1::uuid[])`, [prods]).catch(() => undefined);
    await p.query(`DELETE FROM product_lots WHERE product_id = ANY($1::uuid[])`, [prods]).catch(() => undefined);
    await p.query(`DELETE FROM product_store_stock WHERE product_id = ANY($1::uuid[])`, [prods]).catch(() => undefined);
    await p.query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [prods]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  const vitrine = async (productId: string) =>
    parseFloat((await testPool().query(`SELECT vitrine_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`, [productId, fx.storeId])).rows[0].vitrine_quantity);
  const lotV = async (lotId: string) => {
    const r = await testPool().query(`SELECT vitrine_qty, sold_qty FROM product_lots WHERE id = $1`, [lotId]);
    return { vitrine: parseFloat(r.rows[0].vitrine_qty), sold: parseFloat(r.rows[0].sold_qty) };
  };

  it('retour : recredite le lot d origine, vitrine et lot restent en phase', async () => {
    await returnRepository.create({
      originalSaleId: S1, userId: fx.userId, storeId: fx.storeId,
      type: 'return', refundAmount: 6,
      items: [{ saleItemId: SIp, productId: P, quantity: 1, unitPrice: 6, subtotal: 6 }],
    });
    expect(await vitrine(P)).toBeCloseTo(5, 3);            // 4 + 1
    const l = await lotV(Lp);
    expect(l.vitrine).toBeCloseTo(5, 3);                   // 4 + 1 (recredite)
    expect(l.sold).toBeCloseTo(0, 3);                      // 1 - 1
  });

  it('echange : decremente un lot FEFO du nouveau produit + recredite le rendu', async () => {
    await returnRepository.create({
      originalSaleId: S2, userId: fx.userId, storeId: fx.storeId,
      type: 'exchange', refundAmount: 6,
      items: [{ saleItemId: SIr, productId: R, quantity: 1, unitPrice: 6, subtotal: 6 }],
      exchangeProducts: [{ saleItemId: SIr, newProductId: Q, quantity: 1 }],
    });
    // Produit rendu R : recredite (2 -> 3), lot en phase.
    expect(await vitrine(R)).toBeCloseTo(3, 3);
    expect((await lotV(Lr)).vitrine).toBeCloseTo(3, 3);
    // Nouveau produit Q donne au client : decremente vitrine ET lot (3 -> 2).
    expect(await vitrine(Q)).toBeCloseTo(2, 3);
    expect((await lotV(Lq)).vitrine).toBeCloseTo(2, 3);
  });
});
