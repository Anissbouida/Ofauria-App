/**
 * F-030 — La fenetre des invendus ignore les sessions datees dans le futur.
 *
 * Avant : la fenetre de ventes demarrait a la derniere session FERMEE (toutes
 * dates confondues). Une session fermee dans le futur (horloge de poste
 * decalee, session oubliee) devenait le debut de fenetre et masquait toutes les
 * ventes du jour (sold_qty = 0). Desormais on ignore les sessions dont
 * closed_at/opened_at > NOW() et on plafonne le debut de fenetre a maintenant.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, cleanupFixtures, RUN, type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Invendus — fenetre de ventes vs session future (F-030)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let unsoldDecisionRepository: typeof import('../../repositories/unsold-decision.repository.js').unsoldDecisionRepository;
  let fx: Fixtures;
  let productId: string; let sessionId: string; let saleId: string;

  beforeAll(async () => {
    repos = await importRepositories();
    unsoldDecisionRepository = (await import('../../repositories/unsold-decision.repository.js')).unsoldDecisionRepository;
    fx = await createBaseFixtures();
    const p = testPool();

    const prod = await p.query(
      `INSERT INTO products (name, slug, price, sale_type, sale_unit)
       VALUES ($1, $2, 5, 'jour', 'unit') RETURNING id`,
      [`Pain f030 ${RUN}`, `pain-f030-${RUN}`]
    );
    productId = prod.rows[0].id;

    // Session FERMEE dans le futur (+30 j) : le piege de F-030.
    const sess = await p.query(
      `INSERT INTO cash_register_sessions (user_id, store_id, status, opening_amount, closed_at)
       VALUES ($1, $2, 'closed', 0, NOW() + INTERVAL '30 days') RETURNING id`,
      [fx.userId, fx.storeId]
    );
    sessionId = sess.rows[0].id;

    // Vente d'aujourd'hui : 2 pieces.
    const sale = await p.query(
      `INSERT INTO sales (sale_number, user_id, store_id, subtotal, total, payment_method)
       VALUES ($1, $2, $3, 10, 10, 'cash') RETURNING id`,
      [`F30${RUN}`.slice(0, 20), fx.userId, fx.storeId]
    );
    saleId = sale.rows[0].id;
    await p.query(
      `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal)
       VALUES ($1, $2, 2, 5, 10)`,
      [saleId, productId]
    );
  }, 60_000);

  afterAll(async () => {
    const p = testPool();
    await p.query(`DELETE FROM sale_items WHERE sale_id = $1`, [saleId]).catch(() => undefined);
    await p.query(`DELETE FROM sales WHERE id = $1`, [saleId]).catch(() => undefined);
    await p.query(`DELETE FROM cash_register_sessions WHERE id = $1`, [sessionId]).catch(() => undefined);
    await p.query(`DELETE FROM products WHERE id = $1`, [productId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('les ventes du jour sont comptees malgre une session fermee dans le futur', async () => {
    const rows = await unsoldDecisionRepository.getUnsoldWithSuggestions(fx.storeId);
    const mine = rows.find((r: Record<string, unknown>) => r.product_id === productId);
    expect(mine).toBeDefined();
    expect(Number(mine!.sold_qty)).toBe(2);   // avant le fix : 0 (fenetre masquee)
  });
});
