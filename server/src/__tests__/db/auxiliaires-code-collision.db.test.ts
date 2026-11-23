/**
 * Mig 629 — un code d'auxiliaire en collision ne laisse plus un tiers sans auxiliaire.
 *
 * Le code est « préfixe + 6 lettres du nom + 4 caractères de l'id ». Deux fournisseurs dont
 * le nom commence pareil et dont l'id commence par les mêmes 4 caractères tombaient sur le
 * même code : le second restait sans auxiliaire (ON CONFLICT DO NOTHING) et toutes ses
 * écritures partaient en file d'attente (« Auxiliaire manquant pour compte 4411 »).
 * Même chose, en plus fréquent, pour deux clients société (prénom et nom vides).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';

describe.skipIf(!hasTestDb)('Auxiliaires — code en collision (mig 629)', () => {
  // Deux ids qui partagent leurs 4 premiers caractères.
  const base = randomUUID();
  const prefix = base.slice(0, 4);
  const id1 = base;
  const id2 = prefix + randomUUID().slice(4);
  const created: { suppliers: string[]; customers: string[] } = { suppliers: [], customers: [] };

  afterAll(async () => {
    const p = testPool();
    await p.query(`DELETE FROM account_auxiliaries WHERE supplier_id = ANY($1) OR customer_id = ANY($2)`, [created.suppliers, created.customers]);
    await p.query(`DELETE FROM suppliers WHERE id = ANY($1)`, [created.suppliers]);
    await p.query(`DELETE FROM customers WHERE id = ANY($1)`, [created.customers]);
    await closeTestPool();
  });

  it('deux fournisseurs au même code court ont chacun leur auxiliaire', async () => {
    const p = testPool();
    // Le déclencheur suppliers_auxiliary crée l'auxiliaire à l'insertion.
    await p.query(`INSERT INTO suppliers (id, name) VALUES ($1, $2), ($3, $4)`,
      [id1, `Minoterie Atlas ${RUN}`, id2, `Minoterie du Nord ${RUN}`]);
    created.suppliers.push(id1, id2);
    const aux = (await p.query(
      `SELECT supplier_id, code FROM account_auxiliaries WHERE supplier_id = ANY($1)`, [[id1, id2]])).rows;
    expect(aux).toHaveLength(2);
    expect(aux.find(a => a.supplier_id === id1)?.code).toBe(`4411-FOUR-MINOTE-${prefix}`);
    expect(new Set(aux.map(a => a.code)).size).toBe(2);
    expect(aux.every(a => a.code.length <= 30)).toBe(true);
  });

  it('deux clients société (sans prénom ni nom) ont chacun leur auxiliaire, libellé = raison sociale', async () => {
    const p = testPool();
    await p.query(`INSERT INTO customers (id, company_name) VALUES ($1, $2), ($3, $4)`,
      [id1, `Café Central ${RUN}`, id2, `Hôtel Atlas ${RUN}`]);
    created.customers.push(id1, id2);
    await p.query(`SELECT fn_ensure_customer_auxiliary(id) FROM unnest($1::uuid[]) AS id`, [[id1, id2]]);
    const aux = (await p.query(
      `SELECT customer_id, code, label FROM account_auxiliaries WHERE customer_id = ANY($1)`, [[id1, id2]])).rows;
    expect(aux).toHaveLength(2);
    expect(new Set(aux.map(a => a.code)).size).toBe(2);
    expect(aux.find(a => a.customer_id === id1)?.label).toBe(`Café Central ${RUN}`);
    // Idempotent : un second appel ne crée rien.
    await p.query(`SELECT fn_ensure_customer_auxiliary($1)`, [id1]);
    const n = (await p.query(`SELECT count(*)::int AS n FROM account_auxiliaries WHERE customer_id = $1`, [id1])).rows[0].n;
    expect(n).toBe(1);
  });
});
