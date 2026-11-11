/**
 * Phase 6.5 (mig 488) — historique des prix + mise à jour en masse.
 *
 *  - une hausse de 5 % sur une famille met à jour les prix et laisse une trace (motif, %) ;
 *  - un changement de prix ordinaire est aussi journalisé par le trigger.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, RUN } from './helpers.js';
import { priceListRepository } from '../../repositories/pricing.repository.js';

describe.skipIf(!hasTestDb)('Historique et mise à jour en masse des prix', () => {
  const p = () => testPool();
  const family = `Fam-${RUN}`.slice(0, 40);
  let categoryId: number;
  let productId: string;
  let userId: string;

  beforeAll(async () => {
    categoryId = (await p().query(`INSERT INTO categories (name, slug, family) VALUES ($1,$2,$3) RETURNING id`, [`Cat ${RUN}`, `cat-${RUN}`, family])).rows[0].id;
    productId = (await p().query(`INSERT INTO products (name, slug, price, category_id) VALUES ($1,$2,10,$3) RETURNING id`, [`Prod Ph ${RUN}`, `prod-ph-${RUN}`, categoryId])).rows[0].id;
    userId = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,'x','P','H','admin') RETURNING id`, [`ph-${RUN}@test.local`])).rows[0].id;
  });

  afterAll(async () => {
    await p().query(`DELETE FROM price_change_log WHERE product_id = $1`, [productId]).catch(() => undefined);
    await p().query(`DELETE FROM products WHERE id = $1`, [productId]).catch(() => undefined);
    await p().query(`DELETE FROM categories WHERE id = $1`, [categoryId]).catch(() => undefined);
    await p().query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => undefined);
    await closeTestPool();
  });

  it('applique +5 % sur la famille et trace le changement', async () => {
    const r = await priceListRepository.bulkUpdatePrices({ family, mode: 'increase_pct', value: 5, reason: 'Hausse 2026' }, userId);
    expect(r.count).toBe(1);
    const prod = (await p().query(`SELECT price FROM products WHERE id = $1`, [productId])).rows[0];
    expect(Number(prod.price)).toBe(10.5); // 10 × 1,05
    const hist = await priceListRepository.priceHistory(productId);
    expect(hist.length).toBeGreaterThanOrEqual(1);
    expect(Number(hist[0].old_price)).toBe(10);
    expect(Number(hist[0].new_price)).toBe(10.5);
    expect(Number(hist[0].pct)).toBe(5);
    expect(hist[0].reason).toBe('Hausse 2026');
    expect(hist[0].batch_id).toBe(r.batchId);
  });

  it('journalise aussi une modification de prix ordinaire', async () => {
    await p().query(`UPDATE products SET price = 12 WHERE id = $1`, [productId]);
    const hist = await priceListRepository.priceHistory(productId);
    expect(Number(hist[0].new_price)).toBe(12);
    expect(hist[0].reason).toBeNull(); // pas de contexte posé
  });
});
