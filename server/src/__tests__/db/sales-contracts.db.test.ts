/**
 * Phase 11 (D3-37) — contrats-cadres / commandes ouvertes.
 *
 *  - un contrat au volume suit le consommé par appels (commandes rattachées) ;
 *  - un contrat à la valeur suit le montant consommé ;
 *  - un appel visant un autre client est refusé.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, TEST_DATABASE_URL, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Contrats-cadres', () => {
  const p = () => testPool();
  let salesContractRepository: typeof import('../../repositories/sales-contract.repository.js')['salesContractRepository'];

  let userId: string, custA: string, custB: string, productId: string;
  const orderIds: string[] = [];
  const contractIds: string[] = [];

  // Insère une commande (+ 1 ligne) sans passer par le sourcing, pour le test.
  const seedOrder = async (customerId: string, qty: number, unitPrice: number) => {
    const c = await p().connect();
    try {
      await c.query(`SET session_replication_role = 'replica'`);
      const total = qty * unitPrice;
      const o = (await c.query(
        `INSERT INTO orders (order_number, customer_id, user_id, type, subtotal, tax_amount, discount_amount, total, payment_method, status)
         VALUES ($1,$2,$3,'commande',$4,0,0,$4,'pending','pending') RETURNING id`,
        [`CMD-${RUN}-${orderIds.length}`.slice(0, 20), customerId, userId, total])).rows[0].id;
      await c.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal, status)
         VALUES ($1,$2,$3,$4,$5,'pending')`, [o, productId, qty, unitPrice, total]);
      orderIds.push(o);
      return o as string;
    } finally {
      await c.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      c.release();
    }
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-0123456789abcdef0123456789abcdef';
    ({ salesContractRepository } = await import('../../repositories/sales-contract.repository.js'));

    userId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,'x','C','T','admin') RETURNING id`, [`ctr-${RUN}@test.local`])).rows[0].id;
    custA = (await p().query(`INSERT INTO customers (first_name, last_name, company_name, customer_type) VALUES ('Pro','A ${RUN}','Alpha ${RUN}','professionnel') RETURNING id`)).rows[0].id;
    custB = (await p().query(`INSERT INTO customers (first_name, last_name, company_name, customer_type) VALUES ('Pro','B ${RUN}','Bravo ${RUN}','professionnel') RETURNING id`)).rows[0].id;
    productId = (await p().query(`INSERT INTO products (name, slug, price, item_kind) VALUES ($1,$2,50,'resale') RETURNING id`, [`Art CTR ${RUN}`, `art-ctr-${RUN}`])).rows[0].id;
  });

  afterAll(async () => {
    const c = await p().connect();
    try {
      await c.query(`SET session_replication_role = 'replica'`);
      for (const o of orderIds) { await c.query(`DELETE FROM order_items WHERE order_id = $1`, [o]).catch(() => undefined); await c.query(`DELETE FROM orders WHERE id = $1`, [o]).catch(() => undefined); }
      for (const id of contractIds) await c.query(`DELETE FROM sales_contracts WHERE id = $1`, [id]).catch(() => undefined);
      await c.query(`DELETE FROM products WHERE id = $1`, [productId]).catch(() => undefined);
      for (const id of [custA, custB]) await c.query(`DELETE FROM customers WHERE id = $1`, [id]).catch(() => undefined);
      await c.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
    } finally {
      await c.query(`SET session_replication_role = 'origin'`).catch(() => undefined);
      c.release();
    }
    await closeTestPool();
  });

  it('contrat au volume : suit le consommé par appels', async () => {
    const cr = await salesContractRepository.create({
      customerId: custA, basis: 'quantity', productId, committedQuantity: 1000,
      startDate: '2026-01-01', createdBy: userId,
    });
    expect('data' in cr).toBe(true);
    const id = (cr as { data: { id: string } }).data.id;
    contractIds.push(id);

    let c = await salesContractRepository.getWithConsumption(id);
    expect(c!.consumed).toBe(0);
    expect(c!.remaining).toBe(1000);

    const o1 = await seedOrder(custA, 300, 50);
    const r = await salesContractRepository.recordRelease(id, o1);
    expect('data' in r).toBe(true);
    c = (r as { data: NonNullable<Awaited<ReturnType<typeof salesContractRepository.getWithConsumption>>> }).data;
    expect(c!.consumed).toBe(300);
    expect(c!.remaining).toBe(700);
    expect(c!.releases.length).toBe(1);
  });

  it('contrat à la valeur : suit le montant consommé', async () => {
    const cr = await salesContractRepository.create({
      customerId: custA, basis: 'value', committedValue: 50000,
      startDate: '2026-01-01', createdBy: userId,
    });
    const id = (cr as { data: { id: string } }).data.id;
    contractIds.push(id);

    const o = await seedOrder(custA, 240, 50); // total 12000
    await salesContractRepository.recordRelease(id, o);
    const c = await salesContractRepository.getWithConsumption(id);
    expect(c!.consumed).toBe(12000);
    expect(c!.remaining).toBe(38000);
  });

  it('refuse un appel visant un autre client', async () => {
    const cr = await salesContractRepository.create({
      customerId: custA, basis: 'value', committedValue: 10000, startDate: '2026-01-01', createdBy: userId,
    });
    const id = (cr as { data: { id: string } }).data.id;
    contractIds.push(id);
    const o = await seedOrder(custB, 10, 50);
    const r = await salesContractRepository.recordRelease(id, o);
    expect('error' in r).toBe(true);
  });
});
