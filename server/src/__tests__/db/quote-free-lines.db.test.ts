/**
 * Phase 11 (D3-24) — lignes libres et sections de devis.
 *
 *  - un devis mêle article (prix catalogue), ligne libre (prix saisi) et section
 *    (titre sans montant) ; le sous-total somme article + libre ;
 *  - un devis sans aucune ligne chiffrée est refusé ;
 *  - la conversion en commande ignore les sections et REFUSE les lignes libres.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, TEST_DATABASE_URL, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Lignes libres et sections de devis', () => {
  const p = () => testPool();
  let quoteRepository: typeof import('../../repositories/quote.repository.js')['quoteRepository'];

  let userId: string, storeId: string, productId: string;
  const quoteIds: string[] = [];
  const orderIds: string[] = [];
  const ctx = () => ({ userId, storeId: null, validityDays: 30, role: 'admin' as const });

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
    ({ quoteRepository } = await import('../../repositories/quote.repository.js'));
    storeId = (await p().query(`INSERT INTO stores (name, city) VALUES ($1,'T') RETURNING id`, [`Mag FL ${RUN}`])).rows[0].id;
    userId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role, store_id) VALUES ($1,'x','F','L','admin',$2) RETURNING id`, [`fl-${RUN}@test.local`, storeId])).rows[0].id;
    productId = (await p().query(`INSERT INTO products (name, slug, price, item_kind) VALUES ($1,$2,50,'resale') RETURNING id`, [`Art FL ${RUN}`, `art-fl-${RUN}`])).rows[0].id;
  });

  afterAll(async () => {
    const c = await p().connect();
    try {
      await c.query(`SET session_replication_role = 'replica'`);
      for (const id of orderIds) { await c.query(`DELETE FROM order_items WHERE order_id = $1`, [id]).catch(() => undefined); await c.query(`DELETE FROM orders WHERE id = $1`, [id]).catch(() => undefined); }
      for (const id of quoteIds) {
        await c.query(`DELETE FROM quote_events WHERE quote_id = $1`, [id]).catch(() => undefined);
        await c.query(`DELETE FROM quote_items WHERE quote_id = $1`, [id]).catch(() => undefined);
      }
      await c.query(`UPDATE quotes SET order_id = NULL WHERE id = ANY($1::uuid[])`, [quoteIds]).catch(() => undefined);
      for (const id of quoteIds) await c.query(`DELETE FROM quotes WHERE id = $1`, [id]).catch(() => undefined);
      await c.query(`DELETE FROM products WHERE id = $1`, [productId]).catch(() => undefined);
      await c.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
      await c.query(`DELETE FROM stores WHERE id = $1`, [storeId]).catch(() => undefined);
    } finally {
      await c.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      c.release();
    }
    await closeTestPool();
  });

  it('mêle article, ligne libre et section', async () => {
    const r = await quoteRepository.create({
      prospectName: `Client FL ${RUN}`, withTax: false,
      items: [
        { lineType: 'section', description: 'Lot 1 — Prestations' },
        { productId, quantity: 2 },                                   // 2 × 50 = 100
        { lineType: 'free', description: 'Étude sur mesure', quantity: 1, unitPrice: 300 },
      ],
    }, ctx());
    expect('data' in r).toBe(true);
    const q = (r as { data: Record<string, any> }).data;
    quoteIds.push(q.id);
    expect(q.items.map((i: Record<string, any>) => i.line_type)).toEqual(['section', 'product', 'free']);
    expect(Number(q.subtotal)).toBe(400);  // 100 (article) + 300 (libre), section 0
    expect(Number(q.total)).toBe(400);      // prospect en TTC, pas de TVA ajoutée
  });

  it('refuse un devis sans aucune ligne chiffrée', async () => {
    const r = await quoteRepository.create({ prospectName: 'X', withTax: false, items: [{ lineType: 'section', description: 'Juste un titre' }] }, ctx());
    expect('error' in r).toBe(true);
  });

  it('la conversion refuse les lignes libres et ignore les sections', async () => {
    // Devis avec une ligne libre : conversion refusée.
    const withFree = await quoteRepository.create({
      prospectName: `FL libre ${RUN}`, withTax: false,
      items: [{ productId, quantity: 1 }, { lineType: 'free', description: 'Forfait', quantity: 1, unitPrice: 100 }],
    }, ctx());
    const qf = (withFree as { data: { id: string } }).data; quoteIds.push(qf.id);
    await quoteRepository.transition(qf.id, 'send', { userId });
    const cf = await quoteRepository.convert(qf.id, { pickupDate: '2026-12-01', userId, storeId: null });
    expect('error' in cf).toBe(true);

    // Devis article + section : conversion OK, la section n'entre pas dans la commande.
    const withSection = await quoteRepository.create({
      prospectName: `FL section ${RUN}`, withTax: false,
      items: [{ lineType: 'section', description: 'Lot A' }, { productId, quantity: 3 }],
    }, ctx());
    const qs = (withSection as { data: { id: string } }).data; quoteIds.push(qs.id);
    await quoteRepository.transition(qs.id, 'send', { userId });
    const cs = await quoteRepository.convert(qs.id, { pickupDate: '2026-12-01', userId, storeId: null });
    expect('order' in cs).toBe(true);
    const orderId = (cs as { order: { id: string } }).order.id;
    orderIds.push(orderId);
    const n = (await p().query(`SELECT count(*)::int AS n FROM order_items WHERE order_id = $1`, [orderId])).rows[0].n;
    expect(n).toBe(1); // seule la ligne article, pas la section
  });
});
