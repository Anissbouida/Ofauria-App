/**
 * Constat 124 — TVA d'achat absente.
 *
 * Le code TVA par défaut (mig 309, default_tax_code sur ingrédient / consommable /
 * catégorie de charges) est désormais saisissable sur les fiches, et le taux est proposé
 * à la création des lignes de bon de commande :
 *   taux saisi > code de l'article > code de sa catégorie > NULL (taux à préciser).
 * Même règle que la facture issue de la réception (reception-voucher.repository).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('BC — taux de TVA proposé depuis le code par défaut (constat 124)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let pos: typeof import('../../repositories/purchase-order.repository.js').purchaseOrderRepository;
  let ingredients: typeof import('../../repositories/inventory.repository.js').ingredientRepository;
  let packaging: typeof import('../../repositories/packaging-item.repository.js').packagingItemRepository;
  let fx: Fixtures;
  let supplierId = '', catN20 = '', catNone = '';
  let ingCoded = '', ingFromCat = '', ingNothing = '', ingR10InN20 = '', pkgCoded = '';
  const poIds: string[] = [];
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    pos = (await import('../../repositories/purchase-order.repository.js')).purchaseOrderRepository;
    ingredients = (await import('../../repositories/inventory.repository.js')).ingredientRepository;
    packaging = (await import('../../repositories/packaging-item.repository.js')).packagingItemRepository;
    fx = await createBaseFixtures();
    supplierId = (await p().query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`Fournisseur TVA ${RUN}`])).rows[0].id;
    catN20 = (await p().query(
      `INSERT INTO expense_categories (name, type, level, requires_po, default_tax_code) VALUES ($1, 'expense', 1, false, 'N20') RETURNING id`,
      [`Cat N20 ${RUN}`])).rows[0].id;
    catNone = (await p().query(
      `INSERT INTO expense_categories (name, type, level, requires_po) VALUES ($1, 'expense', 1, false) RETURNING id`,
      [`Cat sans code ${RUN}`])).rows[0].id;

    // Fiches créées par le dépôt (chemin de la fiche ingrédient / consommable).
    ingCoded = (await ingredients.create({ name: `Beurre tva ${RUN}`, unit: 'kg', unitCost: 80, categoryId: catNone, storeId: fx.storeId, defaultTaxCode: 'N20' })).id;
    ingFromCat = (await ingredients.create({ name: `Farine tva ${RUN}`, unit: 'kg', unitCost: 8, categoryId: catN20, storeId: fx.storeId })).id;
    ingNothing = (await ingredients.create({ name: `Sel tva ${RUN}`, unit: 'kg', unitCost: 3, categoryId: catNone, storeId: fx.storeId })).id;
    ingR10InN20 = (await ingredients.create({ name: `Sucre tva ${RUN}`, unit: 'kg', unitCost: 9, categoryId: catN20, storeId: fx.storeId, defaultTaxCode: 'R10' })).id;
    fx.ids.ingredients.push(ingCoded, ingFromCat, ingNothing, ingR10InN20);
    pkgCoded = (await packaging.create({ name: `Boîte tva ${RUN}`, category_id: catNone, default_tax_code: 'N20' })).id;
  }, 60_000);

  afterAll(async () => {
    const run = async (sql: string, params: unknown[]) => { try { await p().query(sql, params); } catch { /* best effort */ } };
    await run(`DELETE FROM po_line_events WHERE po_line_id IN (SELECT id FROM purchase_order_items WHERE purchase_order_id = ANY($1::uuid[]))`, [poIds]);
    await run(`DELETE FROM purchase_order_items WHERE purchase_order_id = ANY($1::uuid[])`, [poIds]);
    await run(`DELETE FROM purchase_orders WHERE id = ANY($1::uuid[])`, [poIds]);
    await run(`DELETE FROM packaging_items WHERE id = $1`, [pkgCoded]);
    await run(`DELETE FROM suppliers WHERE id = $1`, [supplierId]);
    if (fx) await cleanupFixtures(fx);
    await run(`DELETE FROM expense_categories WHERE id = ANY($1::uuid[])`, [[catN20, catNone]]);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  /** Crée un BC et renvoie le taux de chaque ligne, dans l'ordre des articles. */
  const ratesOf = async (items: Record<string, unknown>[]) => {
    const po = await pos.create({ supplierId, createdBy: fx.userId, storeId: fx.storeId, items } as never) as { id: string };
    poIds.push(po.id);
    const rows = (await p().query(
      `SELECT ingredient_id, packaging_id, line_type, tva_rate FROM purchase_order_items WHERE purchase_order_id = $1`, [po.id])).rows;
    return items.map(it => {
      const row = rows.find(r => (it.ingredientId && r.ingredient_id === it.ingredientId)
        || (it.packagingId && r.packaging_id === it.packagingId)
        || (!it.ingredientId && !it.packagingId && r.line_type === it.lineType));
      return row?.tva_rate == null ? null : Number(row.tva_rate);
    });
  };

  it('la fiche ingrédient enregistre et efface le code TVA', async () => {
    expect((await ingredients.findById(ingCoded)).default_tax_code).toBe('N20');
    await ingredients.update(ingNothing, { defaultTaxCode: 'R10' });
    expect((await ingredients.findById(ingNothing)).default_tax_code).toBe('R10');
    await ingredients.update(ingNothing, { defaultTaxCode: null });
    expect((await ingredients.findById(ingNothing)).default_tax_code).toBeNull();
  });

  it('ingrédient codé N20 → ligne de BC à 20 %', async () => {
    expect(await ratesOf([{ ingredientId: ingCoded, quantityOrdered: 5, unitPrice: 80 }])).toEqual([20]);
  });

  it('ingrédient sans code, catégorie N20 → 20 % (hérité de la catégorie)', async () => {
    expect(await ratesOf([{ ingredientId: ingFromCat, quantityOrdered: 25, unitPrice: 8 }])).toEqual([20]);
  });

  it('ni article ni catégorie codés → NULL (taux à préciser, jamais 0 implicite)', async () => {
    expect(await ratesOf([{ ingredientId: ingNothing, quantityOrdered: 1, unitPrice: 3 }])).toEqual([null]);
  });

  it('le code de l\'article prime sur celui de la catégorie ; consommable et ligne de service suivent la même règle', async () => {
    expect(await ratesOf([
      { ingredientId: ingR10InN20, quantityOrdered: 10, unitPrice: 9 },
      { packagingId: pkgCoded, quantityOrdered: 100, unitPrice: 1 },
      { lineType: 'service', description: 'Maintenance four', categoryId: catN20, quantityOrdered: 1, unitPrice: 500 },
    ])).toEqual([10, 20, 20]);
  });

  it('un taux saisi n\'est jamais remplacé', async () => {
    expect(await ratesOf([{ ingredientId: ingCoded, quantityOrdered: 1, unitPrice: 80, tvaRate: 7 }])).toEqual([7]);
  });

  it('la modification admin d\'un BC propose aussi le taux sur une ligne ajoutée', async () => {
    const po = await pos.create({ supplierId, createdBy: fx.userId, storeId: fx.storeId,
      items: [{ ingredientId: ingNothing, quantityOrdered: 1, unitPrice: 3 }] } as never) as { id: string };
    poIds.push(po.id);
    const existing = (await p().query(`SELECT id FROM purchase_order_items WHERE purchase_order_id = $1`, [po.id])).rows[0].id;
    await pos.replaceItems(po.id, [
      { id: existing, ingredientId: ingNothing, quantityOrdered: 1, unitPrice: 3 },
      { ingredientId: ingFromCat, quantityOrdered: 25, unitPrice: 8 },
    ], fx.userId, fx.storeId);
    const rows = (await p().query(
      `SELECT ingredient_id, tva_rate FROM purchase_order_items WHERE purchase_order_id = $1`, [po.id])).rows;
    expect(rows.find(r => r.ingredient_id === ingFromCat)?.tva_rate).not.toBeNull();
    expect(Number(rows.find(r => r.ingredient_id === ingFromCat)?.tva_rate)).toBe(20);
    expect(rows.find(r => r.ingredient_id === ingNothing)?.tva_rate).toBeNull();
  });
});
