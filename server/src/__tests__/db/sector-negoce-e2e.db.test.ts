/**
 * Phase 9.4 (mig 497) — deuxième secteur réel : négoce, de bout en bout.
 *
 *  - le pack « négoce » active le commercial SANS fabrication (pas de production ni
 *    recettes : aucun écran boulangerie) ;
 *  - un article de revente (item_kind='resale', sans recette) va du devis à la livraison
 *    (le reste du cycle — facture, encaissement — est couvert par les suites O2C,
 *    indépendantes du type d'article).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';
import { sectorRepository } from '../../repositories/sector.repository.js';
import { quoteRepository } from '../../repositories/quote.repository.js';
import { deliveryNoteRepository } from '../../repositories/delivery-note.repository.js';

describe.skipIf(!hasTestDb)('Secteur négoce — de bout en bout', () => {
  const p = () => testPool();
  let storeId: string;
  let userId: string;
  let customerId: string;
  let productId: string;
  let lotId: string;
  let quoteId: string;
  let dnId: string;

  beforeAll(async () => {
    storeId = (await p().query(`INSERT INTO stores (name, city, kind) VALUES ($1,'T','warehouse') RETURNING id`, [`Mag Ng ${RUN}`])).rows[0].id;
    userId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role, store_id) VALUES ($1,'x','N','G','admin',$2) RETURNING id`, [`ng-${RUN}@test.local`, storeId])).rows[0].id;
    customerId = (await p().query(`INSERT INTO customers (first_name, last_name, customer_type) VALUES ('Pro','Ng ${RUN}','professionnel') RETURNING id`)).rows[0].id;
    // Article de REVENTE, sans recette.
    productId = (await p().query(`INSERT INTO products (name, slug, price, item_kind) VALUES ($1,$2,25,'resale') RETURNING id`, [`Art Ng ${RUN}`, `art-ng-${RUN}`])).rows[0].id;
    lotId = (await p().query(
      `INSERT INTO product_lots (product_id, store_id, lot_number, quantity_total, backroom_qty, vitrine_qty, status)
       VALUES ($1,$2,$3,100,100,0,'active') RETURNING id`, [productId, storeId, `LN-${RUN}`.slice(0, 20)])).rows[0].id;
  });

  afterAll(async () => {
    const cc = await p().connect();
    try {
      await cc.query(`SET session_replication_role = 'replica'`);
      await cc.query(`DELETE FROM delivery_note_item_lots WHERE delivery_note_item_id IN (SELECT id FROM delivery_note_items WHERE delivery_note_id = $1)`, [dnId]).catch(() => undefined);
      await cc.query(`DELETE FROM delivery_note_items WHERE delivery_note_id = $1`, [dnId]).catch(() => undefined);
      await cc.query(`DELETE FROM delivery_notes WHERE id = $1`, [dnId]).catch(() => undefined);
      await cc.query(`DELETE FROM quote_items WHERE quote_id = $1`, [quoteId]).catch(() => undefined);
      await cc.query(`DELETE FROM quote_events WHERE quote_id = $1`, [quoteId]).catch(() => undefined);
      await cc.query(`DELETE FROM quotes WHERE id = $1`, [quoteId]).catch(() => undefined);
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

  it('le pack négoce active le commercial sans fabrication', async () => {
    const packs = await sectorRepository.list();
    const ng = packs.find(pk => pk.code === 'negoce');
    expect(ng).toBeTruthy();
    expect(ng!.modules).toContain('sales');
    expect(ng!.modules).toContain('orders');
    expect(ng!.modules).not.toContain('production');
    expect(ng!.modules).not.toContain('recipes');
  });

  it('un article de revente va du devis à la livraison', async () => {
    // Devis.
    const q = await quoteRepository.create(
      { customerId, items: [{ productId, quantity: 10 }] },
      { userId, storeId, validityDays: 30, role: 'admin' });
    expect('error' in q).toBe(false);
    const quote = (q as { data: { id: string; total: string | number } }).data;
    quoteId = quote.id;
    expect(Number(quote.total)).toBeGreaterThan(0);

    // Livraison : BL préparé puis expédié (le stock du négoce sort).
    const dn = await deliveryNoteRepository.createPrepared({
      customerId, storeId, createdBy: userId,
      items: [{ productId, description: null, orderItemId: null, quantity: 4, unitPrice: 25, tvaRate: null }],
    });
    dnId = dn.id;
    const shipped = await deliveryNoteRepository.ship(dnId, userId);
    expect(shipped.status).toBe('shipped');
    const lot = (await p().query(`SELECT backroom_qty FROM product_lots WHERE id = $1`, [lotId])).rows[0];
    expect(Number(lot.backroom_qty)).toBe(96); // 100 − 4, sans aucune recette ni écran de fabrication
  });
});
