/**
 * Phase 6.4 (mig 487) — prix plancher.
 *
 * priceLines (validation partagée commandes/devis) refuse un prix sous le plancher pour
 * un rôle non-admin ; l'administrateur peut déroger. Sans plancher, rien ne change.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';
import { priceLines } from '../../controllers/order.controller.js';

describe.skipIf(!hasTestDb)('Prix plancher', () => {
  const p = () => testPool();
  let productId: string;
  let userId: string;

  beforeAll(async () => {
    productId = (await p().query(`INSERT INTO products (name, slug, price, floor_price) VALUES ($1,$2,50,40) RETURNING id`, [`Prod Fp ${RUN}`, `prod-fp-${RUN}`])).rows[0].id;
    userId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,'x','F','P','admin') RETURNING id`, [`fp-${RUN}@test.local`])).rows[0].id;
  });

  afterAll(async () => {
    await p().query(`DELETE FROM products WHERE id = $1`, [productId]).catch(() => undefined);
    await p().query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
    await closeTestPool();
  });

  // Prix catalogue 50, plancher 40. Le gérant peut déroger (motif), mais pas sous le plancher.
  it('refuse un prix sous le plancher, même pour le gérant', async () => {
    const r = await priceLines(
      [{ productId, quantity: 1, unitPrice: 35 }], // 30 % sous 50 : dérogation gérant permise…
      null,
      { role: 'manager', userId, overrideReason: 'remise exceptionnelle' },
    );
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error).toMatch(/plancher/); // …mais sous le plancher (40) : refusé
  });

  it('autorise l\'administrateur à déroger sous le plancher', async () => {
    const r = await priceLines(
      [{ productId, quantity: 1, unitPrice: 35 }],
      null,
      { role: 'admin', userId, overrideReason: 'geste commercial' },
    );
    expect('error' in r).toBe(false);
  });

  it('au-dessus du plancher : dérogation gérant acceptée', async () => {
    const r = await priceLines(
      [{ productId, quantity: 1, unitPrice: 45 }], // 10 % sous 50, au-dessus du plancher 40
      null,
      { role: 'manager', userId, overrideReason: 'client fidèle' },
    );
    expect('error' in r).toBe(false);
  });
});
