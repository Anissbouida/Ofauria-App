/**
 * Phase 4.2 (mig 475) — partenaire payeur. resolvePayer suit payer_customer_id
 * (une filiale paie via le siège) avec garde anti-cycle, et rend le client
 * lui-même quand il n'a pas de payeur distinct.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';
import { customerRepository } from '../../repositories/customer.repository.js';

describe.skipIf(!hasTestDb)('Partenaire payeur', () => {
  const p = () => testPool();
  const ids: string[] = [];
  let siege: string, filiale: string, solo: string;

  const mkCustomer = async (name: string): Promise<string> => {
    const id = (await p().query(`INSERT INTO customers (first_name) VALUES ($1) RETURNING id`, [`${name} ${RUN}`])).rows[0].id;
    ids.push(id);
    return id;
  };

  beforeAll(async () => {
    siege = await mkCustomer('Siege');
    filiale = await mkCustomer('Filiale');
    solo = await mkCustomer('Solo');
    await p().query(`UPDATE customers SET payer_customer_id = $1 WHERE id = $2`, [siege, filiale]);
  });

  afterAll(async () => {
    // Casser les liens avant suppression (FK SET NULL gère aussi).
    await p().query(`UPDATE customers SET payer_customer_id = NULL WHERE id = ANY($1)`, [ids]).catch(() => undefined);
    await p().query(`DELETE FROM customers WHERE id = ANY($1)`, [ids]).catch(() => undefined);
    await closeTestPool();
  });

  it('résout la filiale vers le siège', async () => {
    expect(await customerRepository.resolvePayer(p(), filiale)).toBe(siege);
  });

  it('rend le client lui-même sans payeur distinct', async () => {
    expect(await customerRepository.resolvePayer(p(), solo)).toBe(solo);
    expect(await customerRepository.resolvePayer(p(), siege)).toBe(siege);
  });

  it('termine sur un cycle (garde anti-boucle)', async () => {
    // siege paie via filiale, filiale paie via siege : la résolution doit
    // s'arrêter au lieu de boucler indéfiniment.
    await p().query(`UPDATE customers SET payer_customer_id = $1 WHERE id = $2`, [filiale, siege]);
    const out = await customerRepository.resolvePayer(p(), siege);
    expect([siege, filiale]).toContain(out); // un id valide, pas de boucle infinie
  });
});
