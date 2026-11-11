/**
 * Phase 10.2 — API publique : clés, webhooks, « un site marchand crée une commande ».
 *
 *  - une clé vérifie/rejette correctement (hash, révocation) ;
 *  - enqueue ne vise que les points ACTIFS abonnés à l'événement, signés ;
 *  - createPublicOrder crée une vraie commande ET met la notification en file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, TEST_DATABASE_URL, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('API publique', () => {
  const p = () => testPool();
  // Importés après avoir posé DATABASE_URL (db lit l'URL à l'import).
  let apiKeyRepository: typeof import('../../repositories/api-key.repository.js')['apiKeyRepository'];
  let webhookRepository: typeof import('../../repositories/webhook.repository.js')['webhookRepository'];
  let signPayload: typeof import('../../repositories/webhook.repository.js')['signPayload'];
  let createPublicOrder: typeof import('../../services/public-order.service.js')['createPublicOrder'];

  let storeId: string, userId: string, productId: string;
  let keyRow: { id: string; store_id: string | null; created_by: string | null; key: string };
  let orderId: string | undefined;
  const epIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
    ({ apiKeyRepository } = await import('../../repositories/api-key.repository.js'));
    ({ webhookRepository, signPayload } = await import('../../repositories/webhook.repository.js'));
    ({ createPublicOrder } = await import('../../services/public-order.service.js'));

    storeId = (await p().query(`INSERT INTO stores (name, city, kind) VALUES ($1,'T','warehouse') RETURNING id`, [`Mag API ${RUN}`])).rows[0].id;
    userId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role, store_id) VALUES ($1,'x','A','P','admin',$2) RETURNING id`, [`api-${RUN}@test.local`, storeId])).rows[0].id;
    productId = (await p().query(`INSERT INTO products (name, slug, price, item_kind) VALUES ($1,$2,25,'resale') RETURNING id`, [`Art API ${RUN}`, `art-api-${RUN}`])).rows[0].id;
  });

  afterAll(async () => {
    const c = await p().connect();
    try {
      await c.query(`SET session_replication_role = 'replica'`);
      if (orderId) {
        await c.query(`DELETE FROM order_items WHERE order_id = $1`, [orderId]).catch(() => undefined);
        await c.query(`DELETE FROM orders WHERE id = $1`, [orderId]).catch(() => undefined);
      }
      for (const id of epIds) {
        await c.query(`DELETE FROM webhook_deliveries WHERE endpoint_id = $1`, [id]).catch(() => undefined);
        await c.query(`DELETE FROM webhook_endpoints WHERE id = $1`, [id]).catch(() => undefined);
      }
      await c.query(`DELETE FROM api_keys WHERE created_by = $1`, [userId]).catch(() => undefined);
      await c.query(`DELETE FROM products WHERE id = $1`, [productId]).catch(() => undefined);
      await c.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
      await c.query(`DELETE FROM stores WHERE id = $1`, [storeId]).catch(() => undefined);
    } finally {
      await c.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      c.release();
    }
    await closeTestPool();
  });

  it('crée une clé, la vérifie, rejette les mauvaises et les révoquées', async () => {
    keyRow = await apiKeyRepository.create({ label: 'Site marchand', scopes: ['orders:create', 'products:read'], createdBy: userId });
    expect(keyRow.key).toMatch(/^kalum_[0-9a-f]+$/);

    const ok = await apiKeyRepository.verify(keyRow.key);
    expect(ok?.id).toBe(keyRow.id);
    expect(ok?.scopes).toContain('orders:create');

    expect(await apiKeyRepository.verify('kalum_deadbeefdeadbeefdeadbeef')).toBeNull();
    expect(await apiKeyRepository.verify('not-a-key')).toBeNull();

    // Une seconde clé révoquée n'est plus acceptée.
    const k2 = await apiKeyRepository.create({ label: 'Temp', scopes: [], createdBy: userId });
    await apiKeyRepository.revoke(k2.id);
    expect(await apiKeyRepository.verify(k2.key)).toBeNull();
  });

  it('enqueue ne vise que les points actifs abonnés, et signe', async () => {
    const ev = `order.created`;
    const active = await webhookRepository.createEndpoint({ label: 'Actif', url: 'https://example.test/hook', events: [ev], createdBy: userId });
    const inactive = await webhookRepository.createEndpoint({ label: 'Inactif', url: 'https://example.test/off', events: [ev], createdBy: userId });
    const other = await webhookRepository.createEndpoint({ label: 'Autre', url: 'https://example.test/other', events: ['invoice.created'], createdBy: userId });
    epIds.push(active.id, inactive.id, other.id);
    await webhookRepository.setActive(inactive.id, false);

    const payload = { event: ev, n: 1 };
    const n = await webhookRepository.enqueue(ev, payload);
    expect(n).toBe(1); // seul le point actif abonné

    const d = (await p().query(`SELECT endpoint_id, signature, status FROM webhook_deliveries WHERE endpoint_id = $1`, [active.id])).rows[0];
    expect(d.status).toBe('queued');
    expect(d.signature).toBe(signPayload(active.secret, payload));
  });

  it('un site marchand crée une commande (et la notification part)', async () => {
    const before = (await p().query(`SELECT count(*)::int AS n FROM webhook_deliveries`)).rows[0].n;
    const r = await createPublicOrder(
      { id: keyRow.id, store_id: keyRow.store_id, created_by: keyRow.created_by },
      { customerName: 'Boutique en ligne', items: [{ productId, quantity: 4 }] },
    );
    expect('error' in r).toBe(false);
    const ok = r as { id: string; orderNumber: string; total: number };
    orderId = ok.id;
    expect(ok.total).toBe(100); // 4 × 25, prix catalogue

    const order = (await p().query(`SELECT type, total, customer_name FROM orders WHERE id = $1`, [ok.id])).rows[0];
    expect(order.type).toBe('online');
    expect(Number(order.total)).toBe(100);

    // Une livraison order.created de plus (le point actif de l'autre test).
    const after = (await p().query(`SELECT count(*)::int AS n FROM webhook_deliveries`)).rows[0].n;
    expect(after).toBeGreaterThan(before);
  });
});
