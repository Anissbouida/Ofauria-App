/**
 * F-024 — L'ecart de reception d'un approvisionnement est trace (plus de
 * disparition silencieuse), sans destruction de stock a l'aveugle.
 *
 * Demande : 2 pieces vers la vitrine ; recu : 1. Avant, la piece manquante
 * restait en reserve sans aucune trace (« l'ecart disparait »). Desormais :
 *   - une anomalie est journalisee (product_stock_transactions type 'adjustment',
 *     quantity_change 0 : le stock n'est PAS mute, la piece est toujours la) ;
 *   - le gerant est notifie (replenishment_discrepancy) ;
 *   - la reserve garde la piece non transferee (pas de perte decidee a sa place).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, cleanupFixtures, RUN, type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Reception appro — ecart trace sans muter le stock (F-024)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let replenishmentRepository: typeof import('../../repositories/replenishment.repository.js').replenishmentRepository;
  let fx: Fixtures;
  let productId: string; let requestId: string; let itemId: string;

  beforeAll(async () => {
    repos = await importRepositories();
    replenishmentRepository = (await import('../../repositories/replenishment.repository.js')).replenishmentRepository;
    fx = await createBaseFixtures();
    const p = testPool();

    const prod = await p.query(
      `INSERT INTO products (name, slug, price, sale_type, sale_unit)
       VALUES ($1, $2, 4, 'jour', 'unit') RETURNING id`,
      [`Pain f024 ${RUN}`, `pain-f024-${RUN}`]
    );
    productId = prod.rows[0].id;
    // 5 en reserve, rien en vitrine.
    await p.query(
      `INSERT INTO product_store_stock (product_id, store_id, stock_quantity, stock_min_threshold, vitrine_quantity)
       VALUES ($1, $2, 5, 0, 0)`,
      [productId, fx.storeId]
    );

    const req = await p.query(
      `INSERT INTO replenishment_requests (request_number, requested_by, store_id, status)
       VALUES ($1, $2, $3, 'transferred') RETURNING id`,
      [`RQ${RUN}`.slice(0, 20), fx.userId, fx.storeId]
    );
    requestId = req.rows[0].id;
    const it = await p.query(
      `INSERT INTO replenishment_request_items (request_id, product_id, requested_quantity, qty_to_store, status)
       VALUES ($1, $2, 2, 2, 'ready') RETURNING id`,
      [requestId, productId]
    );
    itemId = it.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    const p = testPool();
    await p.query(`DELETE FROM product_stock_transactions WHERE product_id = $1`, [productId]).catch(() => undefined);
    await p.query(`DELETE FROM replenishment_request_items WHERE request_id = $1`, [requestId]).catch(() => undefined);
    await p.query(`DELETE FROM replenishment_requests WHERE id = $1`, [requestId]).catch(() => undefined);
    await p.query(`DELETE FROM product_store_stock WHERE product_id = $1`, [productId]).catch(() => undefined);
    await p.query(`DELETE FROM notifications WHERE store_id = $1`, [fx.storeId]).catch(() => undefined);
    await p.query(`DELETE FROM products WHERE id = $1`, [productId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('recu 1 pour 2 demandes : anomalie tracee, reserve intacte, demande en ecart', async () => {
    await replenishmentRepository.confirmReception(requestId, fx.userId, [{ itemId, qtyReceived: 1 }]);
    const p = testPool();

    // 1. Anomalie journalisee sans mutation de stock.
    const anomaly = await p.query(
      `SELECT quantity_change, note FROM product_stock_transactions
        WHERE product_id = $1 AND type = 'adjustment' AND note ILIKE '%Ecart reception appro%'`,
      [productId]
    );
    expect(anomaly.rows).toHaveLength(1);
    expect(parseFloat(anomaly.rows[0].quantity_change)).toBe(0);

    // 2. Reserve : 5 - 1 transfere en vitrine = 4 ; la piece manquante RESTE en
    //    reserve (pas de perte decidee a l'aveugle).
    const stock = await p.query(
      `SELECT stock_quantity, vitrine_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`,
      [productId, fx.storeId]
    );
    expect(parseFloat(stock.rows[0].stock_quantity)).toBeCloseTo(4, 3);
    expect(parseFloat(stock.rows[0].vitrine_quantity)).toBeCloseTo(1, 3);

    // 3. Demande cloturee avec ecart + notification gerant.
    const reqRow = await p.query(`SELECT status FROM replenishment_requests WHERE id = $1`, [requestId]);
    expect(reqRow.rows[0].status).toBe('closed_with_discrepancy');
    const notif = await p.query(
      `SELECT 1 FROM notifications WHERE store_id = $1 AND type = 'replenishment_discrepancy'`, [fx.storeId]
    );
    expect(notif.rows.length).toBeGreaterThan(0);
  });
});
