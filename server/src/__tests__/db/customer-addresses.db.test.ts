/**
 * Phase 4.1 (mig 474) — référentiel d'adresses client. CRUD multi-adresses,
 * un seul défaut de livraison / facturation par client, et resolveText qui
 * donne l'adresse à figer sur une pièce (défaut du rôle, sinon 'both', sinon
 * repli sur l'adresse unique legacy du client).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';
import { customerAddressRepository } from '../../repositories/customer-address.repository.js';

describe.skipIf(!hasTestDb)("Adresses client", () => {
  const p = () => testPool();
  let custId: string;
  let legacyId: string;

  beforeAll(async () => {
    custId = (await p().query(`INSERT INTO customers (first_name) VALUES ($1) RETURNING id`, [`Multi ${RUN}`])).rows[0].id;
    legacyId = (await p().query(`INSERT INTO customers (first_name, address, city) VALUES ($1, '5 av. Legacy', 'Rabat') RETURNING id`, [`Legacy ${RUN}`])).rows[0].id;
  });

  afterAll(async () => {
    await p().query(`DELETE FROM customers WHERE id = ANY($1)`, [[custId, legacyId]]).catch(() => undefined);
    await closeTestPool();
  });

  it('crée une adresse par défaut et la résout en texte figeable', async () => {
    await customerAddressRepository.create(custId, {
      addressLine: '10 rue Mohammed V', postalCode: '20000', city: 'Casablanca',
      isDefaultDelivery: true, isDefaultBilling: true,
    });
    const list = await customerAddressRepository.list(custId);
    expect(list).toHaveLength(1);
    const txt = await customerAddressRepository.resolveText(p(), custId, 'delivery');
    expect(txt).toBe('10 rue Mohammed V, 20000 Casablanca');
  });

  it("n'autorise qu'un seul défaut de livraison par client", async () => {
    await customerAddressRepository.create(custId, { addressLine: '2 bd Zerktouni', city: 'Casablanca', isDefaultDelivery: true });
    const defaults = (await p().query(
      `SELECT COUNT(*)::int AS n FROM customer_addresses WHERE customer_id = $1 AND is_default_delivery`, [custId]
    )).rows[0].n;
    expect(defaults).toBe(1); // le nouveau défaut a chassé l'ancien
    const txt = await customerAddressRepository.resolveText(p(), custId, 'delivery');
    expect(txt).toBe('2 bd Zerktouni, Casablanca');
  });

  it("repli sur l'adresse unique legacy quand il n'y a pas de référentiel", async () => {
    const txt = await customerAddressRepository.resolveText(p(), legacyId, 'delivery');
    expect(txt).toBe('5 av. Legacy, Rabat');
  });
});
