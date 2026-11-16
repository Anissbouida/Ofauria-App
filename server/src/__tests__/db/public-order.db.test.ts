/**
 * G0-01 (plan d'action 2026-11) — API publique de commande.
 *
 *  - un prix négatif est refusé par le schéma ;
 *  - un prix envoyé par une clé sans la portée `orders:price_override` est ignoré ;
 *  - avec la portée : prix accepté, mais jamais sous le prix plancher ;
 *  - la même clé d'idempotence rejouée ne crée qu'une commande ;
 *  - la TVA d'un client professionnel n'est plus nulle ;
 *  - un client bloqué (credit_hold) est refusé.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, TEST_DATABASE_URL, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('API publique — commande (G0-01)', () => {
  const p = () => testPool();
  let createPublicOrder: typeof import('../../services/public-order.service.js')['createPublicOrder'];
  let publicApiController: typeof import('../../controllers/public.controller.js')['publicApiController'];
  let publicOrderSchema: typeof import('../../validators/public-order.validator.js')['publicOrderSchema'];
  let apiKeyRepository: typeof import('../../repositories/api-key.repository.js')['apiKeyRepository'];

  let userId: string, productId: string, taxedProductId: string, proId: string, heldId: string;
  let plainKey: { id: string; store_id: string | null; created_by: string | null; scopes: string[] };
  let overrideKey: typeof plainKey;
  const orderIds: string[] = [];

  /** Réponse Express minimale : retient le statut et le corps. */
  const fakeRes = () => {
    const r = { statusCode: 200, body: undefined as any, headers: {} as Record<string, string>,
      status(c: number) { r.statusCode = c; return r; },
      json(b: unknown) { r.body = b; return r; },
      setHeader(k: string, v: string) { r.headers[k] = v; } };
    return r;
  };
  const fakeReq = (key: typeof plainKey, body: unknown, idem?: string) => ({
    apiKey: key, body,
    header: (n: string) => (n.toLowerCase() === 'idempotency-key' ? idem : undefined),
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
    ({ createPublicOrder } = await import('../../services/public-order.service.js'));
    ({ publicApiController } = await import('../../controllers/public.controller.js'));
    ({ publicOrderSchema } = await import('../../validators/public-order.validator.js'));
    ({ apiKeyRepository } = await import('../../repositories/api-key.repository.js'));

    userId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,'x','A','P','admin') RETURNING id`, [`pubord-${RUN}@test.local`])).rows[0].id;
    productId = (await p().query(`INSERT INTO products (name, slug, price, item_kind, floor_price) VALUES ($1,$2,25,'resale',10) RETURNING id`, [`Art G001 ${RUN}`, `art-g001-${RUN}`])).rows[0].id;
    // Article HT à 20 % : la TVA d'un professionnel doit s'ajouter.
    taxedProductId = (await p().query(`INSERT INTO products (name, slug, price, item_kind, tax_code, price_includes_tax) VALUES ($1,$2,100,'resale','N20',false) RETURNING id`, [`Art HT ${RUN}`, `art-ht-${RUN}`])).rows[0].id;
    proId = (await p().query(`INSERT INTO customers (first_name, last_name, company_name, customer_type) VALUES ('Pro','G001 ${RUN}','Societe ${RUN}','professionnel') RETURNING id`)).rows[0].id;
    heldId = (await p().query(`INSERT INTO customers (first_name, last_name, customer_type, credit_hold, credit_hold_reason) VALUES ('Bloque','G001 ${RUN}','particulier',true,'impayés') RETURNING id`)).rows[0].id;

    const k1 = await apiKeyRepository.create({ label: `Site ${RUN}`, scopes: ['orders:create'], createdBy: userId });
    const k2 = await apiKeyRepository.create({ label: `Site prix ${RUN}`, scopes: ['orders:create', 'orders:price_override'], createdBy: userId });
    plainKey = { id: k1.id, store_id: k1.store_id, created_by: k1.created_by, scopes: k1.scopes };
    overrideKey = { id: k2.id, store_id: k2.store_id, created_by: k2.created_by, scopes: k2.scopes };
  });

  afterAll(async () => {
    const c = await p().connect();
    try {
      await c.query(`SET session_replication_role = 'replica'`);
      for (const id of orderIds) {
        await c.query(`DELETE FROM order_items WHERE order_id = $1`, [id]).catch(() => undefined);
        await c.query(`DELETE FROM orders WHERE id = $1`, [id]).catch(() => undefined);
      }
      await c.query(`DELETE FROM credit_check_events WHERE customer_id = ANY($1)`, [[proId, heldId]]).catch(() => undefined);
      await c.query(`DELETE FROM api_keys WHERE created_by = $1`, [userId]).catch(() => undefined);
      await c.query(`DELETE FROM customers WHERE id = ANY($1)`, [[proId, heldId]]).catch(() => undefined);
      await c.query(`DELETE FROM products WHERE id = ANY($1)`, [[productId, taxedProductId]]).catch(() => undefined);
      await c.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
    } finally {
      await c.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      c.release();
    }
    await closeTestPool();
  });

  it('refuse un prix négatif, une quantité nulle et un champ inconnu (schéma)', () => {
    const base = { customerName: 'Site', items: [{ productId, quantity: 1 }] };
    expect(publicOrderSchema.safeParse(base).success).toBe(true);
    expect(publicOrderSchema.safeParse({ ...base, items: [{ productId, quantity: 1, unitPrice: -5 }] }).success).toBe(false);
    expect(publicOrderSchema.safeParse({ ...base, items: [{ productId, quantity: 0 }] }).success).toBe(false);
    expect(publicOrderSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    expect(publicOrderSchema.safeParse({ ...base, storeId: 'x' }).success).toBe(false);
    expect(publicOrderSchema.safeParse({ ...base, items: [{ productId: 'pas-un-uuid', quantity: 1 }] }).success).toBe(false);
  });

  it('ignore le prix envoyé par une clé sans la portée', async () => {
    const r = await createPublicOrder(plainKey, { customerName: 'Site', items: [{ productId, quantity: 2, unitPrice: 1 }] });
    expect('error' in r).toBe(false);
    const ok = r as { id: string; total: number };
    orderIds.push(ok.id);
    expect(ok.total).toBe(50); // 2 × 25 : prix catalogue, pas 1
    const line = (await p().query(`SELECT unit_price FROM order_items WHERE order_id = $1`, [ok.id])).rows[0];
    expect(Number(line.unit_price)).toBe(25);
  });

  it('avec la portée : prix accepté, mais jamais sous le plancher', async () => {
    const r = await createPublicOrder(overrideKey, { customerName: 'Site', items: [{ productId, quantity: 2, unitPrice: 20 }] });
    expect('error' in r).toBe(false);
    orderIds.push((r as { id: string }).id);
    expect((r as { total: number }).total).toBe(40);

    const low = await createPublicOrder(overrideKey, { customerName: 'Site', items: [{ productId, quantity: 2, unitPrice: 5 }] });
    expect('error' in low && low.error).toMatch(/plancher/);
  });

  it('la même clé d\'idempotence rejouée ne crée qu\'une commande', async () => {
    const idem = `idem-${RUN}-0001`;
    const body = { customerName: `Idem ${RUN}`, items: [{ productId, quantity: 1 }] };
    const res1 = fakeRes();
    await publicApiController.createOrder(fakeReq(plainKey, body, idem) as never, res1 as never);
    expect(res1.statusCode).toBe(201);
    orderIds.push(res1.body.data.id);

    const res2 = fakeRes();
    await publicApiController.createOrder(fakeReq(plainKey, body, idem) as never, res2 as never);
    expect(res2.statusCode).toBe(201);
    expect(res2.body.data.id).toBe(res1.body.data.id);
    expect(res2.headers['Idempotent-Replayed']).toBe('true');

    const n = (await p().query(`SELECT count(*)::int AS n FROM orders WHERE customer_name = $1`, [`Idem ${RUN}`])).rows[0].n;
    expect(n).toBe(1);

    // La même clé d'idempotence sous une AUTRE clé d'API est indépendante.
    const res3 = fakeRes();
    await publicApiController.createOrder(fakeReq(overrideKey, body, idem) as never, res3 as never);
    expect(res3.statusCode).toBe(201);
    expect(res3.body.data.id).not.toBe(res1.body.data.id);
    orderIds.push(res3.body.data.id);
  });

  it('un refus libère la clé d\'idempotence', async () => {
    const idem = `idem-${RUN}-0002`;
    const res1 = fakeRes();
    await publicApiController.createOrder(fakeReq(plainKey, { customerId: heldId, items: [{ productId, quantity: 1 }] }, idem) as never, res1 as never);
    expect(res1.statusCode).toBe(409);
    const left = (await p().query(`SELECT count(*)::int AS n FROM api_idempotency_keys WHERE key = $1`, [idem])).rows[0].n;
    expect(left).toBe(0);
  });

  it('calcule la TVA d\'un client professionnel', async () => {
    const r = await createPublicOrder(plainKey, { customerId: proId, items: [{ productId: taxedProductId, quantity: 3 }] });
    expect('error' in r).toBe(false);
    const ok = r as { id: string; subtotal: number; taxAmount: number; total: number };
    orderIds.push(ok.id);
    expect(ok.subtotal).toBe(300);
    expect(ok.taxAmount).toBe(60);
    expect(ok.total).toBe(360);
    const o = (await p().query(`SELECT tax_amount, total, payment_method FROM orders WHERE id = $1`, [ok.id])).rows[0];
    expect(Number(o.tax_amount)).toBe(60);
    expect(o.payment_method).toBe('deferred');
    const line = (await p().query(`SELECT tva_rate FROM order_items WHERE order_id = $1`, [ok.id])).rows[0];
    expect(Number(line.tva_rate)).toBe(20);
  });

  it('refuse un client bloqué', async () => {
    const r = await createPublicOrder(plainKey, { customerId: heldId, items: [{ productId, quantity: 1 }] });
    expect('error' in r).toBe(true);
    expect((r as { status?: number }).status).toBe(409);
    expect((r as { error: string }).error).toMatch(/bloqué/i);
  });
});
