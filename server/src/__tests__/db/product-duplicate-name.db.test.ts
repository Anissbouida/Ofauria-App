/**
 * Scénario 1, constat 100 — produit en doublon.
 *  - créer un produit du même nom qu'un existant répond 409 « Un produit du même nom existe
 *    déjà » (avant : erreur SQL non rattrapée, requête sans réponse, écran figé) ;
 *  - renommer un produit vers un nom pris répond de même ;
 *  - toutes les routes produits passent par asyncHandler (Express 4 ne rattrape pas seul
 *    les erreurs des fonctions async).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe('Routes produits : erreurs asynchrones rattrapées', () => {
  it('chaque handler du contrôleur produit est enveloppé par asyncHandler', () => {
    const src = readFileSync(fileURLToPath(new URL('../../routes/products.routes.ts', import.meta.url)), 'utf8');
    const bare = src.split('\n').filter(l => /router\.(get|post|put|patch|delete)\(/.test(l) && /productController\./.test(l) && !/asyncHandler\(productController\./.test(l));
    expect(bare).toEqual([]);
  });
});

describe.skipIf(!hasTestDb)('Produit en doublon (constat 100)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fx: Fixtures;
  let app: express.Express;
  let categoryId = 0;
  const ids: string[] = [];
  const p = () => testPool();
  const name = `Eau doublon ${RUN}`;

  beforeAll(async () => {
    repos = await importRepositories();
    fx = await createBaseFixtures();
    const { productController } = await import('../../controllers/product.controller.js');
    const { asyncHandler } = await import('../../middleware/asyncHandler.js');
    categoryId = (await p().query(`SELECT id FROM categories ORDER BY id LIMIT 1`)).rows[0].id;
    app = express(); app.use(express.json());
    app.use((req, _res, next) => { (req as never as { user: unknown }).user = { userId: fx.userId, role: 'manager', storeId: fx.storeId }; next(); });
    app.post('/products', asyncHandler(productController.create as never));
    app.put('/products/:id', asyncHandler(productController.update as never));
    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ success: false, error: { message: err.message } });
    });
  }, 60_000);

  afterAll(async () => {
    if (ids.length) await p().query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [ids]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  const body = (n: string) => ({ name: n, categoryId, price: 6, costPrice: 3, itemKind: 'resale' });

  it('second produit du même nom : 409 avec un message clair', async () => {
    const first = await request(app).post('/products').send(body(name));
    expect(first.status).toBe(201);
    ids.push(first.body.data.id);
    const dup = await request(app).post('/products').send(body(name));
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toBe('Un produit du même nom existe déjà.');
    const count = (await p().query(`SELECT count(*)::int n FROM products WHERE name = $1`, [name])).rows[0].n;
    expect(count).toBe(1);
  });

  it('renommer vers un nom déjà pris : 409, le produit garde son nom', async () => {
    const other = await request(app).post('/products').send(body(`Soda doublon ${RUN}`));
    expect(other.status).toBe(201);
    ids.push(other.body.data.id);
    const r = await request(app).put(`/products/${other.body.data.id}`).send({ name });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toBe('Un produit du même nom existe déjà.');
    const kept = (await p().query(`SELECT name FROM products WHERE id = $1`, [other.body.data.id])).rows[0].name;
    expect(kept).toBe(`Soda doublon ${RUN}`);
  });
});
