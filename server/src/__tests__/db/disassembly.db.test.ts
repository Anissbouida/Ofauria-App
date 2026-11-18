/**
 * M9 — désassemblage (mig 589) : 2 pièces d'un lot de 5 « Étagère » (2 kg de Tôle chacune)
 * défaites à 80 % de récupération →
 *  - lot : 3 en arrière-boutique, 2 en recyclé (invariant conservé) ;
 *  - matière : un lot de 3,2 kg (2 × 2 × 80 %) rattaché au lot d'origine, inventaire augmenté ;
 *  - pièce numérotée DSA-AAAA-NNNN, visible dans l'historique ;
 *  - quantité supérieure à l'arrière-boutique refusée, sans rien écrire.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createProductWithRecipe, cleanupFixtures, num, RUN, type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Désassemblage (M9)', () => {
  let fx: Fixtures;
  let repo: typeof import('../../repositories/disassembly.repository.js')['disassemblyRepository'];
  let toleId: string; let productId: string; let lotId: string;
  const p = () => testPool();
  const tole = async () => num((await p().query(`SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [toleId, fx.storeId])).rows[0]?.current_quantity);

  beforeAll(async () => {
    await importRepositories();
    repo = (await import('../../repositories/disassembly.repository.js')).disassemblyRepository;
    fx = await createBaseFixtures();
    toleId = await createIngredient(fx, { name: `Tôle dsa ${RUN}`, unit: 'kg', unitCost: 12 });
    productId = (await createProductWithRecipe(fx, {
      name: `Étagère dsa ${RUN}`, price: 150, shelfLifeDays: null,
      ingredients: [{ ingredientId: toleId, quantity: 2, unit: 'kg' }],
    })).productId;
    lotId = (await p().query(
      `INSERT INTO product_lots (product_id, store_id, lot_number, quantity_total, backroom_qty) VALUES ($1, $2, $3, 5, 5) RETURNING id`,
      [productId, fx.storeId, `DSA${RUN}`.slice(0, 30)])).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    const run = async (sql: string, params: unknown[]) => { try { await p().query(sql, params); } catch { /* best effort */ } };
    await run(`DELETE FROM inventory_transactions WHERE ingredient_id = $1`, [toleId]);
    await run(`DELETE FROM disassembly_orders WHERE product_lot_id = $1`, [lotId]);
    await run(`DELETE FROM ingredient_lots WHERE source_product_lot_id = $1`, [lotId]);
    await run(`DELETE FROM product_stock_transactions WHERE product_id = $1`, [productId]);
    await run(`DELETE FROM product_lots WHERE id = $1`, [lotId]);
    if (fx) await cleanupFixtures(fx);
    await closeTestPool();
  }, 60_000);

  it('défait 2 pièces à 80 % : lot, matière, inventaire, pièce DSA', async () => {
    const before = await tole();
    const r = await repo.disassemble({ productLotId: lotId, quantity: 2, recoveryPct: 80, notes: 'Retour défaut' }, fx.userId);
    expect(r.numero).toMatch(/^DSA-\d{4}-\d{4}$/);
    const lot = (await p().query(`SELECT backroom_qty::float8 AS b, recycled_qty::float8 AS rec FROM product_lots WHERE id = $1`, [lotId])).rows[0];
    expect(lot).toEqual({ b: 3, rec: 2 });
    const ingLot = (await p().query(`SELECT economat_quantity::float8 AS q FROM ingredient_lots WHERE source_product_lot_id = $1 AND ingredient_id = $2`, [lotId, toleId])).rows[0];
    expect(ingLot.q).toBeCloseTo(3.2, 4);
    expect(await tole() - before).toBeCloseTo(3.2, 4);
    const hist = await repo.list(fx.storeId);
    expect(hist[0]).toMatchObject({ numero: r.numero, quantity: 2, recovery_pct: 80 });
    // createIngredient suffixe le nom du numéro de passage.
    expect(hist[0].lines).toEqual([expect.objectContaining({ ingredient: expect.stringContaining(`Tôle dsa ${RUN}`), quantity: 3.2, unit: 'kg' })]);
  });

  it('plus que l\'arrière-boutique : refusé, rien d\'écrit', async () => {
    const n = (await p().query(`SELECT COUNT(*)::int AS n FROM disassembly_orders WHERE product_lot_id = $1`, [lotId])).rows[0].n;
    await expect(repo.disassemble({ productLotId: lotId, quantity: 10 }, fx.userId)).rejects.toThrow(/arrière-boutique/);
    expect((await p().query(`SELECT COUNT(*)::int AS n FROM disassembly_orders WHERE product_lot_id = $1`, [lotId])).rows[0].n).toBe(n);
    expect((await p().query(`SELECT backroom_qty::float8 AS b FROM product_lots WHERE id = $1`, [lotId])).rows[0].b).toBe(3);
  });
});
