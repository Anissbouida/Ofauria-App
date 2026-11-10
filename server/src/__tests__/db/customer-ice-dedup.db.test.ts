/**
 * Phase 4.3 — contrôle ICE + doublons. identifierPatterns lit le format du
 * référentiel pays (identifier_types), et findDuplicates SIGNALE un même ICE ou
 * un même nom (en excluant le client courant) au lieu de laisser l'index unique
 * produire une erreur brute.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';
import { customerRepository } from '../../repositories/customer.repository.js';

describe.skipIf(!hasTestDb)('ICE et doublons client', () => {
  const p = () => testPool();
  const ids: string[] = [];
  const ice = '998877665544332'.slice(0, 15);
  const name = `ACME ${RUN}`;

  beforeAll(async () => {
    const a = (await p().query(`INSERT INTO customers (customer_type, company_name, ice) VALUES ('professionnel', $1, $2) RETURNING id`, [name, ice])).rows[0].id;
    const b = (await p().query(`INSERT INTO customers (customer_type, company_name) VALUES ('professionnel', $1) RETURNING id`, [name])).rows[0].id;
    ids.push(a, b);
  });

  afterAll(async () => {
    await p().query(`DELETE FROM customers WHERE id = ANY($1)`, [ids]).catch(() => undefined);
    await closeTestPool();
  });

  it('expose le format ICE du référentiel pays', async () => {
    const pats = await customerRepository.identifierPatterns('MA');
    expect(pats.MA_ICE).toBe('^[0-9]{15}$');
  });

  it('signale un ICE déjà utilisé, en excluant le client lui-même', async () => {
    const hits = await customerRepository.findDuplicates({ ice });
    expect(hits.some(h => h.id === ids[0] && h.reason === 'ICE')).toBe(true);
    const selfExcluded = await customerRepository.findDuplicates({ ice, excludeId: ids[0] });
    expect(selfExcluded).toHaveLength(0);
  });

  it('signale un nom déjà utilisé', async () => {
    const hits = await customerRepository.findDuplicates({ name, excludeId: ids[1] });
    expect(hits.some(h => h.id === ids[0] && h.reason === 'nom')).toBe(true);
  });
});
