/**
 * F-032 — On ne cloture pas la journee en laissant des invendus non traites.
 *
 * Avant : POST /cash-register/close {fin_journee} ne verifiait que les produits
 * DEJA expires (DLC/DLV). Un stock vitrine encore vendable restait non traite,
 * la session fermait, puis POST /unsold-decisions etait refuse (session fermee)
 * -> le stock basculait en perte automatique le lendemain, sans rattrapage.
 *
 * Correctif : le controleur cloture rejette (409 UNSOLD_DECISIONS_PENDING)
 * quand il reste du stock vitrine et qu'AUCUNE decision n'est enregistree pour
 * la session. La logique est portee par
 * unsoldDecisionRepository.vitrineRemainingAndDecisions, testee ici.
 *
 *   vitrine > 0 + 0 decision  -> close bloquee
 *   vitrine > 0 + >=1 decision -> close autorisee
 *   vitrine = 0 (tout vendu)   -> close autorisee
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createProductWithRecipe, cleanupFixtures,
  type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Cloture journee — invendus non traites (F-032)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let unsoldDecisionRepository: typeof import('../../repositories/unsold-decision.repository.js').unsoldDecisionRepository;
  let fx: Fixtures;
  let productId: string;
  let sessionId: string;

  beforeAll(async () => {
    repos = await importRepositories();
    unsoldDecisionRepository = (await import('../../repositories/unsold-decision.repository.js')).unsoldDecisionRepository;
    fx = await createBaseFixtures();
    const ingId = await createIngredient(fx, { name: 'Beurre', unit: 'kg', unitCost: 60 });
    const pr = await createProductWithRecipe(fx, {
      name: 'Croissant f032', price: 3, shelfLifeDays: null,
      ingredients: [{ ingredientId: ingId, quantity: 0.05, unit: 'kg' }],
    });
    productId = pr.productId;

    const sess = await testPool().query(
      `INSERT INTO cash_register_sessions (user_id, store_id, status) VALUES ($1, $2, 'open') RETURNING id`,
      [fx.userId, fx.storeId]
    );
    sessionId = sess.rows[0].id;

    // 10 pieces en vitrine, aucune decision encore prise.
    await testPool().query(
      `INSERT INTO product_store_stock (product_id, store_id, stock_quantity, stock_min_threshold, vitrine_quantity)
       VALUES ($1, $2, 0, 0, 10)`,
      [productId, fx.storeId]
    );
  }, 60_000);

  afterAll(async () => {
    if (fx) {
      await testPool().query(`DELETE FROM unsold_decisions WHERE store_id = $1`, [fx.storeId]).catch(() => undefined);
      await testPool().query(`DELETE FROM cash_register_sessions WHERE id = $1`, [sessionId]).catch(() => undefined);
      await cleanupFixtures(fx);
    }
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('stock vitrine present + aucune decision => cloture bloquee', async () => {
    const r = await unsoldDecisionRepository.vitrineRemainingAndDecisions(sessionId, fx.storeId);
    expect(r.vitrineRemaining).toBeCloseTo(10, 3);
    expect(r.decisionsCount).toBe(0);
    // => le controleur rejette (vitrineRemaining > 0 && decisionsCount === 0).
    expect(r.vitrineRemaining > 0 && r.decisionsCount === 0).toBe(true);
  });

  it('une decision enregistree pour la session => cloture autorisee', async () => {
    await testPool().query(
      `INSERT INTO unsold_decisions
         (store_id, session_id, product_id, product_name, initial_qty, sold_qty, remaining_qty,
          discrepancy, suggested_destination, final_destination, decided_by)
       VALUES ($1, $2, $3, 'Croissant f032', 10, 0, 10, 0, 'reexpose', 'reexpose', $4)`,
      [fx.storeId, sessionId, productId, fx.userId]
    );
    const r = await unsoldDecisionRepository.vitrineRemainingAndDecisions(sessionId, fx.storeId);
    expect(r.decisionsCount).toBe(1);
    expect(r.vitrineRemaining > 0 && r.decisionsCount === 0).toBe(false);
  });

  it('vitrine vide (tout vendu) => cloture autorisee meme sans decision', async () => {
    await testPool().query(`DELETE FROM unsold_decisions WHERE session_id = $1`, [sessionId]);
    await testPool().query(
      `UPDATE product_store_stock SET vitrine_quantity = 0 WHERE product_id = $1 AND store_id = $2`,
      [productId, fx.storeId]
    );
    const r = await unsoldDecisionRepository.vitrineRemainingAndDecisions(sessionId, fx.storeId);
    expect(r.vitrineRemaining).toBe(0);
    expect(r.vitrineRemaining > 0 && r.decisionsCount === 0).toBe(false);
  });
});
