/**
 * Phase 3 (mig 469) — type d'article (item_kind). Un produit se crée sans recette,
 * item_kind par défaut « manufactured » ; productRepository.update le change ; la
 * contrainte refuse une valeur hors liste. Le validateur accepte les 4 natures.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, RUN } from './helpers.js';
import { updateProductSchema } from '../../validators/product.validator.js';

describe.skipIf(!hasTestDb)("Type d'article (item_kind)", () => {
  let products: typeof import('../../repositories/product.repository.js').productRepository;
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  const p = () => testPool();
  const ids: string[] = [];

  beforeAll(async () => {
    repos = await importRepositories();
    products = (await import('../../repositories/product.repository.js')).productRepository;
  });

  afterAll(async () => {
    for (const id of ids) await p().query(`DELETE FROM products WHERE id = $1`, [id]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('se crée sans recette, item_kind par défaut manufactured', async () => {
    const id = (await p().query(
      `INSERT INTO products (name, slug, price) VALUES ($1, $2, 12) RETURNING id, item_kind`,
      [`Eau ${RUN}`, `eau-${RUN}`])).rows[0].id;
    ids.push(id);
    const kind = (await p().query(`SELECT item_kind FROM products WHERE id = $1`, [id])).rows[0].item_kind;
    expect(kind).toBe('manufactured');
  });

  it('update change item_kind ; une valeur hors liste est refusée', async () => {
    const id = (await p().query(
      `INSERT INTO products (name, slug, price) VALUES ($1, $2, 12) RETURNING id`,
      [`Boisson ${RUN}`, `boisson-${RUN}`])).rows[0].id;
    ids.push(id);
    await products.update(id, { itemKind: 'resale' });
    expect((await p().query(`SELECT item_kind FROM products WHERE id = $1`, [id])).rows[0].item_kind).toBe('resale');
    await expect(p().query(`UPDATE products SET item_kind = 'bogus' WHERE id = $1`, [id])).rejects.toThrow();
  });

  it('la liste des produits renvoie item_kind (la fiche ouverte depuis la liste garde « Revente », constat 101)', async () => {
    const name = `Soda liste ${RUN}`;
    const id = (await p().query(
      `INSERT INTO products (name, slug, price, item_kind) VALUES ($1, $2, 7, 'resale') RETURNING id`,
      [name, `soda-liste-${RUN}`])).rows[0].id;
    ids.push(id);
    const { rows } = await products.findAll({ search: name, limit: 10, offset: 0 });
    const row = (rows as Record<string, unknown>[]).find(r => r.id === id);
    expect(row?.item_kind).toBe('resale');
  });

  it('le validateur accepte les 4 natures et refuse une inconnue', () => {
    for (const k of ['manufactured', 'resale', 'service', 'subscription']) {
      expect(updateProductSchema.safeParse({ itemKind: k }).success).toBe(true);
    }
    expect(updateProductSchema.safeParse({ itemKind: 'bogus' }).success).toBe(false);
  });
});
