/**
 * Phase 3.5 (mig 472) — code-barres sur l'article. products.barcode est
 * éditable via productRepository.update et unique (index partiel) : deux
 * articles ne peuvent pas partager un code, mais plusieurs peuvent rester
 * sans code (NULL).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, createBaseFixtures, createProductWithRecipe, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)("Code-barres de l'article", () => {
  let fx: Fixtures;
  let products: typeof import('../../repositories/product.repository.js').productRepository;
  let idA: string;
  let idB: string;
  const p = () => testPool();
  const code = `EAN-${RUN}`;

  beforeAll(async () => {
    fx = await createBaseFixtures();
    products = (await import('../../repositories/product.repository.js')).productRepository;
    ({ productId: idA } = await createProductWithRecipe(fx, { name: 'Art A', price: 5, ingredients: [] }));
    ({ productId: idB } = await createProductWithRecipe(fx, { name: 'Art B', price: 5, ingredients: [] }));
  });

  afterAll(async () => {
    await cleanupFixtures(fx);
    await closeTestPool();
  });

  it('productRepository.update écrit le code-barres', async () => {
    await products.update(idA, { barcode: code });
    const got = (await p().query(`SELECT barcode FROM products WHERE id = $1`, [idA])).rows[0].barcode;
    expect(got).toBe(code);
  });

  it('refuse un code-barres déjà utilisé par un autre article', async () => {
    await expect(p().query(`UPDATE products SET barcode = $1 WHERE id = $2`, [code, idB])).rejects.toThrow();
  });

  it('autorise plusieurs articles sans code-barres (NULL)', async () => {
    // idB est resté sans code ; un troisième NULL ne doit pas heurter l'unicité.
    const { productId: idC } = await createProductWithRecipe(fx, { name: 'Art C', price: 5, ingredients: [] });
    const nulls = (await p().query(
      `SELECT COUNT(*)::int AS n FROM products WHERE id = ANY($1) AND barcode IS NULL`, [[idB, idC]]
    )).rows[0].n;
    expect(nulls).toBe(2);
  });
});
