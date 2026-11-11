/**
 * Phase 8.1 — retours soumis à un seuil et à un délai.
 *
 * Quand la règle est active (forcée ici par l'environnement, par processus) :
 *   - un retour au-delà du délai (14 j par défaut) est refusé ;
 *   - un remboursement au-delà du seuil (500 DH) sans approbation est refusé.
 * Les deux contrôles s'exécutent avant tout traitement, donc le reste n'est pas atteint.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';
import { returnRepository } from '../../repositories/return.repository.js';

describe.skipIf(!hasTestDb)('Retours — seuil et délai', () => {
  const p = () => testPool();
  let storeId: string;
  let userId: string;
  let productId: string;
  let oldSale: string;
  let recentSale: string;

  beforeAll(async () => {
    process.env.ENFORCE_RETURN_RULES = '1';
    storeId = (await p().query(`INSERT INTO stores (name, city) VALUES ($1,'T') RETURNING id`, [`Mag Rl ${RUN}`])).rows[0].id;
    userId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role, store_id) VALUES ($1,'x','R','L','admin',$2) RETURNING id`, [`rl-${RUN}@test.local`, storeId])).rows[0].id;
    productId = (await p().query(`INSERT INTO products (name, slug, price) VALUES ($1,$2,10) RETURNING id`, [`Prod Rl ${RUN}`, `prod-rl-${RUN}`])).rows[0].id;
    oldSale = (await p().query(
      `INSERT INTO sales (sale_number, user_id, subtotal, tax_amount, total, payment_method, payment_status, sale_type, store_id, created_at)
       VALUES ($1,$2,50,0,50,'cash','paid','standard',$3, now() - interval '30 days') RETURNING id`,
      [`T-OLD-${RUN}`.slice(0, 20), userId, storeId])).rows[0].id;
    recentSale = (await p().query(
      `INSERT INTO sales (sale_number, user_id, subtotal, tax_amount, total, payment_method, payment_status, sale_type, store_id)
       VALUES ($1,$2,800,0,800,'cash','paid','standard',$3) RETURNING id`,
      [`T-REC-${RUN}`.slice(0, 20), userId, storeId])).rows[0].id;
  });

  afterAll(async () => {
    delete process.env.ENFORCE_RETURN_RULES;
    await p().query(`DELETE FROM sales WHERE store_id = $1`, [storeId]).catch(() => undefined);
    await p().query(`DELETE FROM products WHERE id = $1`, [productId]).catch(() => undefined);
    await p().query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
    await p().query(`DELETE FROM stores WHERE id = $1`, [storeId]).catch(() => undefined);
    await closeTestPool();
  });

  const line = () => ([{ saleItemId: '00000000-0000-0000-0000-000000000000', productId, quantity: 1, unitPrice: 10, subtotal: 10 }]);

  it('refuse un retour hors délai', async () => {
    await expect(returnRepository.create({ originalSaleId: oldSale, userId, storeId, type: 'return', refundAmount: 10, items: line() }))
      .rejects.toThrow(/hors délai/);
  });

  it('refuse un remboursement au-delà du seuil sans approbation', async () => {
    await expect(returnRepository.create({ originalSaleId: recentSale, userId, storeId, type: 'return', refundAmount: 600, items: line() }))
      .rejects.toThrow(/seuil|approbation/);
  });
});
