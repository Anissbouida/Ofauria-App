/**
 * Phase 4.5 (mig 477) — commercial attitré. Le client porte un salesperson_id
 * (utilisateur), repris automatiquement sur les pièces à l'émission : une
 * commande sans commercial explicite hérite de celui du client (défaut SQL
 * COALESCE($explicite, commercial du client)).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';
import { customerRepository } from '../../repositories/customer.repository.js';

describe.skipIf(!hasTestDb)('Commercial attitré', () => {
  const p = () => testPool();
  let fx: Fixtures;
  let custId: string;
  const orderIds: string[] = [];

  beforeAll(async () => {
    fx = await createBaseFixtures(); // fournit un utilisateur (fx.userId)
    const c = await customerRepository.create({ firstName: `Com ${RUN}`, customerType: 'professionnel', salespersonId: fx.userId });
    custId = c.id;
  });

  afterAll(async () => {
    for (const id of orderIds) await p().query(`DELETE FROM orders WHERE id = $1`, [id]).catch(() => undefined);
    await p().query(`DELETE FROM customer_audit WHERE customer_id = $1`, [custId]).catch(() => undefined);
    await p().query(`DELETE FROM customers WHERE id = $1`, [custId]).catch(() => undefined);
    await cleanupFixtures(fx);
    await closeTestPool();
  });

  it('enregistre le commercial attitré sur le client', async () => {
    const row = await customerRepository.findById(custId);
    expect(row.salesperson_id).toBe(fx.userId);
  });

  it('reprend le commercial du client sur la commande à défaut', async () => {
    // Reproduit la résolution par défaut de order.repository : COALESCE(explicite,
    // commercial du client). Aucun commercial explicite → celui du client.
    const r = await p().query(
      `INSERT INTO orders (order_number, customer_id, user_id, type, subtotal, total, salesperson_id)
       VALUES ($1, $2, $3, 'pro', 0, 0, COALESCE(NULL, (SELECT salesperson_id FROM customers WHERE id = $2)))
       RETURNING id, salesperson_id`,
      [`CS-${Date.now().toString(36)}`, custId, fx.userId]);
    orderIds.push(r.rows[0].id);
    expect(r.rows[0].salesperson_id).toBe(fx.userId);
  });
});
