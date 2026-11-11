/**
 * Phase 7.3 — site d'expédition au choix.
 *
 * Un BL peut être expédié depuis un dépôt (warehouse) distinct du magasin : le stock
 * sort du site choisi. On crée un lot dans le dépôt seulement et on vérifie qu'un BL
 * préparé pour ce dépôt puis expédié décrémente bien le lot du dépôt.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';
import { deliveryNoteRepository } from '../../repositories/delivery-note.repository.js';

describe.skipIf(!hasTestDb)('Site d\'expédition au choix', () => {
  const p = () => testPool();
  let shopId: string;
  let depotId: string;
  let userId: string;
  let customerId: string;
  let productId: string;
  let depotLotId: string;
  let dnId: string;

  beforeAll(async () => {
    shopId = (await p().query(`INSERT INTO stores (name, city, kind) VALUES ($1,'T','shop') RETURNING id`, [`Shop ${RUN}`])).rows[0].id;
    depotId = (await p().query(`INSERT INTO stores (name, city, kind) VALUES ($1,'T','warehouse') RETURNING id`, [`Depot ${RUN}`])).rows[0].id;
    userId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role, store_id) VALUES ($1,'x','S','S','admin',$2) RETURNING id`, [`ss-${RUN}@test.local`, shopId])).rows[0].id;
    customerId = (await p().query(`INSERT INTO customers (first_name, last_name, customer_type) VALUES ('Pro','Ss ${RUN}','professionnel') RETURNING id`)).rows[0].id;
    productId = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1,$2,20) RETURNING id`, [`Prod Ss ${RUN}`, `prod-ss-${RUN}`])).rows[0].id;
    depotLotId = (await p().query(
      `INSERT INTO product_lots (product_id, store_id, lot_number, quantity_total, backroom_qty, vitrine_qty, status)
       VALUES ($1,$2,$3,50,50,0,'active') RETURNING id`, [productId, depotId, `LD-${RUN}`.slice(0, 20)])).rows[0].id;
  });

  afterAll(async () => {
    const cc = await p().connect();
    try {
      await cc.query(`SET session_replication_role = 'replica'`);
      await cc.query(`DELETE FROM delivery_note_item_lots WHERE delivery_note_item_id IN (SELECT id FROM delivery_note_items WHERE delivery_note_id = $1)`, [dnId]).catch(() => undefined);
      await cc.query(`DELETE FROM delivery_note_items WHERE delivery_note_id = $1`, [dnId]).catch(() => undefined);
      await cc.query(`DELETE FROM delivery_notes WHERE id = $1`, [dnId]).catch(() => undefined);
      await cc.query(`DELETE FROM product_lots WHERE id = $1`, [depotLotId]).catch(() => undefined);
      await cc.query(`DELETE FROM product_store_stock WHERE product_id = $1`, [productId]).catch(() => undefined);
      await cc.query(`DELETE FROM products WHERE id = $1`, [productId]).catch(() => undefined);
      await cc.query(`DELETE FROM customers WHERE id = $1`, [customerId]).catch(() => undefined);
      await cc.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
      await cc.query(`DELETE FROM stores WHERE id = ANY($1)`, [[shopId, depotId]]).catch(() => undefined);
    } finally {
      await cc.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      cc.release();
    }
    await closeTestPool();
  });

  it('expédie depuis le dépôt choisi (pas le magasin)', async () => {
    const dn = await deliveryNoteRepository.createPrepared({
      customerId, storeId: depotId, createdBy: userId,
      items: [{ productId, description: null, orderItemId: null, quantity: 8, unitPrice: 20, tvaRate: null }],
    });
    dnId = dn.id;
    expect(dn.store_id).toBe(depotId);
    await deliveryNoteRepository.ship(dnId, userId);
    const lot = (await p().query(`SELECT backroom_qty FROM product_lots WHERE id = $1`, [depotLotId])).rows[0];
    expect(Number(lot.backroom_qty)).toBe(42); // 50 − 8, sorti du dépôt
  });
});
