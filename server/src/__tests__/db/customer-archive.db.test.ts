/**
 * Phase 4.4 (mig 476) — archivage + piste d'audit. On n'efface plus un client :
 * archive() le désactive (is_active=false, archived_at) et restore() le réactive,
 * chaque action étant tracée dans customer_audit (history). La liste filtre les
 * archivés par défaut.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';
import { customerRepository } from '../../repositories/customer.repository.js';

describe.skipIf(!hasTestDb)('Archivage client', () => {
  const p = () => testPool();
  let custId: string;

  beforeAll(async () => {
    custId = (await p().query(`INSERT INTO customers (first_name) VALUES ($1) RETURNING id`, [`Arch ${RUN}`])).rows[0].id;
  });

  afterAll(async () => {
    await p().query(`DELETE FROM customer_audit WHERE customer_id = $1`, [custId]).catch(() => undefined);
    await p().query(`DELETE FROM customers WHERE id = $1`, [custId]).catch(() => undefined);
    await closeTestPool();
  });

  it('archive sans effacer, trace l\'action, et restaure', async () => {
    await customerRepository.archive(custId, null);
    let row = await customerRepository.findById(custId);
    expect(row).not.toBeNull();            // le client existe toujours
    expect(row.is_active).toBe(false);
    expect(row.archived_at).not.toBeNull();

    await customerRepository.restore(custId, null);
    row = await customerRepository.findById(custId);
    expect(row.is_active).toBe(true);
    expect(row.archived_at).toBeNull();

    const hist = await customerRepository.history(custId);
    expect(hist.map(h => h.action)).toEqual(expect.arrayContaining(['archive', 'restore']));
  });

  it('la liste cache les archivés par défaut et les montre à la demande', async () => {
    await customerRepository.archive(custId, null);
    const active = await customerRepository.findAll({ limit: 5000, offset: 0 });
    expect(active.rows.some(r => r.id === custId)).toBe(false);
    const archived = await customerRepository.findAll({ archived: true, limit: 5000, offset: 0 });
    expect(archived.rows.some(r => r.id === custId)).toBe(true);
  });
});
