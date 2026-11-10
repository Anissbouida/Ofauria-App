/**
 * Phase 3.6 (mig 473) — code TVA par défaut de l'article. lineDefaults résout
 * products.tax_code vers le taux courant du référentiel tax_codes : la TVA des
 * lignes de commande/BL découle de l'article. Sans code, repli sur null
 * (comportement antérieur : saisie à la ligne ou dernier taux).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, closeTestPool, createBaseFixtures, createProductWithRecipe, cleanupFixtures, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)("Code TVA par défaut de l'article", () => {
  let fx: Fixtures;
  let products: typeof import('../../repositories/product.repository.js').productRepository;
  let delivery: typeof import('../../repositories/delivery-note.repository.js').deliveryNoteRepository;
  let withCode: string;
  let noCode: string;

  beforeAll(async () => {
    fx = await createBaseFixtures();
    products = (await import('../../repositories/product.repository.js')).productRepository;
    delivery = (await import('../../repositories/delivery-note.repository.js')).deliveryNoteRepository;
    ({ productId: withCode } = await createProductWithRecipe(fx, { name: 'Art TVA20', price: 100, ingredients: [] }));
    ({ productId: noCode } = await createProductWithRecipe(fx, { name: 'Art sans code', price: 100, ingredients: [] }));
    await products.update(withCode, { taxCode: 'N20' });
  });

  afterAll(async () => {
    await cleanupFixtures(fx);
    await closeTestPool();
  });

  it("résout le code TVA de l'article au taux courant (N20 → 20)", async () => {
    const def = await delivery.lineDefaults(null, [withCode]);
    expect(def[withCode]?.tvaRate).toBe(20);
  });

  it('un article sans code TVA ne force aucun taux (null)', async () => {
    const def = await delivery.lineDefaults(null, [noCode]);
    expect(def[noCode]?.tvaRate).toBeNull();
  });
});
