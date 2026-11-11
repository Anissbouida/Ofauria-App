/**
 * Phase 7.2 (règle de gestion) — bon de préparation.
 *
 * pickingList regroupe plusieurs BL préparés (plusieurs commandes) en une liste de
 * prélèvement agrégée par article (total + détail par BL).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';
import { deliveryNoteRepository } from '../../repositories/delivery-note.repository.js';

describe.skipIf(!hasTestDb)('Bon de préparation', () => {
  const p = () => testPool();
  let storeId: string;
  let userId: string;
  let customerId: string;
  let prodA: string;
  let prodB: string;
  const dnIds: string[] = [];

  beforeAll(async () => {
    storeId = (await p().query(`INSERT INTO stores (name, city) VALUES ($1,'T') RETURNING id`, [`Mag Pk ${RUN}`])).rows[0].id;
    userId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role, store_id) VALUES ($1,'x','P','K','admin',$2) RETURNING id`, [`pk-${RUN}@test.local`, storeId])).rows[0].id;
    customerId = (await p().query(`INSERT INTO customers (first_name, last_name, customer_type) VALUES ('Pro','Pk ${RUN}','professionnel') RETURNING id`)).rows[0].id;
    prodA = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1,$2,10) RETURNING id`, [`A ${RUN}`, `a-${RUN}`])).rows[0].id;
    prodB = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1,$2,10) RETURNING id`, [`B ${RUN}`, `b-${RUN}`])).rows[0].id;
    const dn1 = await deliveryNoteRepository.createPrepared({ customerId, storeId, createdBy: userId, items: [
      { productId: prodA, description: null, orderItemId: null, quantity: 5, unitPrice: 10, tvaRate: null },
      { productId: prodB, description: null, orderItemId: null, quantity: 3, unitPrice: 10, tvaRate: null },
    ] });
    const dn2 = await deliveryNoteRepository.createPrepared({ customerId, storeId, createdBy: userId, items: [
      { productId: prodA, description: null, orderItemId: null, quantity: 7, unitPrice: 10, tvaRate: null },
    ] });
    dnIds.push(dn1.id, dn2.id);
  });

  afterAll(async () => {
    const cc = await p().connect();
    try {
      await cc.query(`SET session_replication_role = 'replica'`);
      await cc.query(`DELETE FROM delivery_note_items WHERE delivery_note_id = ANY($1)`, [dnIds]).catch(() => undefined);
      await cc.query(`DELETE FROM delivery_notes WHERE id = ANY($1)`, [dnIds]).catch(() => undefined);
      await cc.query(`DELETE FROM products WHERE id = ANY($1)`, [[prodA, prodB]]).catch(() => undefined);
      await cc.query(`DELETE FROM customers WHERE id = $1`, [customerId]).catch(() => undefined);
      await cc.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
      await cc.query(`DELETE FROM stores WHERE id = $1`, [storeId]).catch(() => undefined);
    } finally {
      await cc.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      cc.release();
    }
    await closeTestPool();
  });

  it('agrège les quantités par article sur plusieurs BL', async () => {
    const pl = await deliveryNoteRepository.pickingList(dnIds);
    expect(pl.notes).toHaveLength(2);
    const a = pl.lines.find(l => l.product_id === prodA);
    expect(Number(a.total)).toBe(12); // 5 + 7
    expect(a.breakdown).toHaveLength(2);
    const b = pl.lines.find(l => l.product_id === prodB);
    expect(Number(b.total)).toBe(3);
  });
});
