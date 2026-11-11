/**
 * Phase 11 (D3-22) — versions et révisions de devis.
 *
 *  - réviser crée une nouvelle version et FIGE l'original (remplacé par) ;
 *  - la chaîne des versions est numérotée (1, 2, …) ;
 *  - seule la version courante apparaît dans la liste ;
 *  - on ne révise pas une version déjà remplacée.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, TEST_DATABASE_URL, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Versions de devis', () => {
  const p = () => testPool();
  let quoteRepository: typeof import('../../repositories/quote.repository.js')['quoteRepository'];

  let userId: string, storeId: string, customerId: string, productId: string;
  let v1: string, v2: string;
  const ctx = () => ({ userId, storeId, validityDays: 30, role: 'admin' as const });

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
    ({ quoteRepository } = await import('../../repositories/quote.repository.js'));

    storeId = (await p().query(`INSERT INTO stores (name, city) VALUES ($1,'T') RETURNING id`, [`Mag QV ${RUN}`])).rows[0].id;
    userId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role, store_id) VALUES ($1,'x','Q','V','admin',$2) RETURNING id`, [`qv-${RUN}@test.local`, storeId])).rows[0].id;
    customerId = (await p().query(`INSERT INTO customers (first_name, last_name, customer_type) VALUES ('Cli','QV ${RUN}','professionnel') RETURNING id`)).rows[0].id;
    productId = (await p().query(`INSERT INTO products (name, slug, price, item_kind) VALUES ($1,$2,50,'resale') RETURNING id`, [`Art QV ${RUN}`, `art-qv-${RUN}`])).rows[0].id;
  });

  afterAll(async () => {
    const c = await p().connect();
    try {
      await c.query(`SET session_replication_role = 'replica'`);
      for (const id of [v2, v1]) {
        if (!id) continue;
        await c.query(`DELETE FROM quote_events WHERE quote_id = $1`, [id]).catch(() => undefined);
        await c.query(`DELETE FROM quote_items WHERE quote_id = $1`, [id]).catch(() => undefined);
      }
      // Casser le lien superseded_by avant de supprimer (FK auto-référente).
      await c.query(`UPDATE quotes SET superseded_by = NULL WHERE id = ANY($1::uuid[])`, [[v1, v2].filter(Boolean)]).catch(() => undefined);
      for (const id of [v2, v1]) if (id) await c.query(`DELETE FROM quotes WHERE id = $1`, [id]).catch(() => undefined);
      await c.query(`DELETE FROM products WHERE id = $1`, [productId]).catch(() => undefined);
      await c.query(`DELETE FROM customers WHERE id = $1`, [customerId]).catch(() => undefined);
      await c.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
      await c.query(`DELETE FROM stores WHERE id = $1`, [storeId]).catch(() => undefined);
    } finally {
      await c.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      c.release();
    }
    await closeTestPool();
  });

  it('réviser crée une version et fige l\'originale', async () => {
    const created = await quoteRepository.create({ customerId, items: [{ productId, quantity: 2, unitPrice: 50 }] }, ctx());
    expect('data' in created).toBe(true);
    v1 = (created as { data: { id: string } }).data.id;

    const rev = await quoteRepository.revise(v1, ctx());
    expect('data' in rev).toBe(true);
    v2 = (rev as { data: { id: string; version: number } }).data.id;
    expect((rev as { data: { version: number } }).data.version).toBe(2);

    // L'originale est figée et remplacée.
    const orig = (await p().query(`SELECT superseded_by, superseded_at FROM quotes WHERE id = $1`, [v1])).rows[0];
    expect(orig.superseded_by).toBe(v2);
    expect(orig.superseded_at).toBeTruthy();

    // Chaîne de versions : 1 puis 2.
    const chain = await quoteRepository.versions(v2);
    expect(chain.map((q: { version: number }) => q.version)).toEqual([1, 2]);
  });

  it('seule la version courante est listée', async () => {
    const list = await quoteRepository.list({ limit: 200, offset: 0, customerId });
    const ids = list.rows.map((q: { id: string }) => q.id);
    expect(ids).toContain(v2);
    expect(ids).not.toContain(v1);
  });

  it('on ne révise pas une version déjà remplacée', async () => {
    const r = await quoteRepository.revise(v1, ctx());
    expect('error' in r).toBe(true);
  });
});
