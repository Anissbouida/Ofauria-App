/**
 * Phase 7.1 (mig 489) — cycle de vie du BL : préparé → expédié → livré.
 *
 *  - createPrepared crée un BL « préparé » SANS sortir le stock (le lot reste intact) ;
 *  - ship sort le stock (le lot diminue, les lots du BL sont enregistrés) et passe « expédié » ;
 *  - markDelivered passe « livré ».
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';
import { deliveryNoteRepository } from '../../repositories/delivery-note.repository.js';

describe.skipIf(!hasTestDb)('BL — cycle de vie préparé/expédié/livré', () => {
  const p = () => testPool();
  let storeId: string;
  let userId: string;
  let customerId: string;
  let productId: string;
  let lotId: string;
  let dnId: string;

  beforeAll(async () => {
    storeId = (await p().query(`INSERT INTO stores (name, city) VALUES ($1,'T') RETURNING id`, [`Mag Dn ${RUN}`])).rows[0].id;
    userId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role, store_id) VALUES ($1,'x','D','N','admin',$2) RETURNING id`, [`dn-${RUN}@test.local`, storeId])).rows[0].id;
    customerId = (await p().query(`INSERT INTO customers (first_name, last_name, customer_type) VALUES ('Pro','Dn ${RUN}','professionnel') RETURNING id`)).rows[0].id;
    productId = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1,$2,20) RETURNING id`, [`Prod Dn ${RUN}`, `prod-dn-${RUN}`])).rows[0].id;
    // Lot avec 100 en réserve, pour que le produit soit suivi par lots et expédiable.
    lotId = (await p().query(
      `INSERT INTO product_lots (product_id, store_id, lot_number, quantity_total, backroom_qty, vitrine_qty, status)
       VALUES ($1,$2,$3,100,100,0,'active') RETURNING id`, [productId, storeId, `L-${RUN}`.slice(0, 20)])).rows[0].id;
    await p().query(
      `INSERT INTO product_store_stock (product_id, store_id, stock_quantity, vitrine_quantity) VALUES ($1,$2,100,0)
       ON CONFLICT (product_id, store_id) DO UPDATE SET stock_quantity = 100`, [productId, storeId]);
  });

  afterAll(async () => {
    const cc = await p().connect();
    try {
      await cc.query(`SET session_replication_role = 'replica'`);
      await cc.query(`DELETE FROM delivery_note_item_lots WHERE delivery_note_item_id IN (SELECT id FROM delivery_note_items WHERE delivery_note_id = $1)`, [dnId]).catch(() => undefined);
      await cc.query(`DELETE FROM delivery_note_items WHERE delivery_note_id = $1`, [dnId]).catch(() => undefined);
      await cc.query(`DELETE FROM delivery_notes WHERE id = $1`, [dnId]).catch(() => undefined);
      await cc.query(`DELETE FROM product_lots WHERE id = $1`, [lotId]).catch(() => undefined);
      await cc.query(`DELETE FROM product_store_stock WHERE product_id = $1`, [productId]).catch(() => undefined);
      await cc.query(`DELETE FROM products WHERE id = $1`, [productId]).catch(() => undefined);
      await cc.query(`DELETE FROM customers WHERE id = $1`, [customerId]).catch(() => undefined);
      await cc.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
      await cc.query(`DELETE FROM stores WHERE id = $1`, [storeId]).catch(() => undefined);
    } finally {
      await cc.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      cc.release();
    }
    await closeTestPool();
  });

  it('createPrepared ne sort pas le stock', async () => {
    const dn = await deliveryNoteRepository.createPrepared({
      customerId, storeId, createdBy: userId,
      items: [{ productId, description: null, orderItemId: null, quantity: 10, unitPrice: 20, tvaRate: null }],
    });
    dnId = dn.id;
    expect(dn.status).toBe('prepared');
    const lot = (await p().query(`SELECT backroom_qty FROM product_lots WHERE id = $1`, [lotId])).rows[0];
    expect(Number(lot.backroom_qty)).toBe(100); // intact
    const lots = (await p().query(`SELECT 1 FROM delivery_note_item_lots dil JOIN delivery_note_items di ON di.id = dil.delivery_note_item_id WHERE di.delivery_note_id = $1`, [dnId])).rows;
    expect(lots).toHaveLength(0);
  });

  it('ship sort le stock et passe expédié', async () => {
    const dn = await deliveryNoteRepository.ship(dnId, userId);
    expect(dn.status).toBe('shipped');
    expect(dn.shipped_at).toBeTruthy();
    const lot = (await p().query(`SELECT backroom_qty FROM product_lots WHERE id = $1`, [lotId])).rows[0];
    expect(Number(lot.backroom_qty)).toBe(90); // 10 expédiés
    const lots = (await p().query(`SELECT dil.quantity FROM delivery_note_item_lots dil JOIN delivery_note_items di ON di.id = dil.delivery_note_item_id WHERE di.delivery_note_id = $1`, [dnId])).rows;
    expect(lots.length).toBeGreaterThanOrEqual(1);
  });

  it('markDelivered passe livré avec preuve de livraison (phase 7.6)', async () => {
    const dn = await deliveryNoteRepository.markDelivered(dnId, {
      receivedByName: 'Réceptionnaire', signature: 'data:image/png;base64,AAAA', reserves: '2 cartons abîmés',
    });
    expect(dn.status).toBe('delivered');
    expect(dn.pod_signature).toBe('data:image/png;base64,AAAA');
    expect(dn.pod_reserves).toBe('2 cartons abîmés'); // le litige se rattache au BL
    expect(dn.delivered_at).toBeTruthy();
  });

  it('refuse un BL « saisie libre » pour un client particulier', async () => {
    // Le flux BL → facture est réservé aux professionnels ; un particulier se règle
    // en caisse. Le chemin sans commande n'était pas gardé (traces de commandes client).
    const partId = (await p().query(`INSERT INTO customers (first_name, last_name, customer_type) VALUES ('Part','Dn ${RUN}','particulier') RETURNING id`)).rows[0].id;
    try {
      await expect(deliveryNoteRepository.create({
        customerId: partId, storeId, createdBy: userId,
        items: [{ productId, description: null, orderItemId: null, quantity: 1, unitPrice: 20, tvaRate: null }],
      })).rejects.toThrow(/particulier/i);
    } finally {
      await p().query(`DELETE FROM customers WHERE id = $1`, [partId]).catch(() => undefined);
    }
  });
});
