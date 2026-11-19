/**
 * M6-02 (mig 605) — produits finis : stock par lot et par emplacement.
 *  - sans emplacement « Magasin » / « Frigo » : message clair, rendement jamais bloqué ;
 *  - rendement 30 vers magasin + 5 vers frigo : rangés dans MAGASIN / FRIGO, deux
 *    mouvements tracés (origine = production) ; une ressaisie ne déplace que l'écart ;
 *  - transfert magasin → frigo tracé ; quantité insuffisante refusée ;
 *  - une vente fait baisser la part rangée (vitrine d'abord), sans mouvement ;
 *  - invariant : Σ emplacements ≤ réserve + vitrine pour tout lot.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Produits finis par emplacement (M6-02)', () => {
  let fx: Fixtures;
  let repo: typeof import('../../repositories/product-lot-location.repository.js')['productLotLocationRepository'];
  const ids: Record<string, string> = {};
  const p = () => testPool();
  const split = async () => Object.fromEntries(((await repo.lotLocations(ids.lot))?.locations ?? []).map((r: Record<string, any>) => [r.code, r.quantity]));
  const apply = (magasin: number, frigo: number, prev = { magasin: 0, frigo: 0 }) => repo.applyRendementDestinations({
    planId: ids.plan, planItemId: ids.item, productId: ids.product, storeId: fx.storeId, userId: fx.userId,
    deltas: [{ dest: 'magasin', delta: magasin - prev.magasin }, { dest: 'frigo', delta: frigo - prev.frigo }],
  });

  beforeAll(async () => {
    await importRepositories();
    repo = (await import('../../repositories/product-lot-location.repository.js')).productLotLocationRepository;
    fx = await createBaseFixtures();
    ids.product = (await p().query(
      `INSERT INTO products (name, slug, price) VALUES ($1, $2, 10) RETURNING id`, [`Croissant ${RUN}`, `croissant-m602-${RUN}`.toLowerCase()])).rows[0].id;
    const def = (await p().query(`SELECT id FROM production_order_types WHERE is_default`)).rows[0].id;
    ids.plan = (await p().query(
      `INSERT INTO production_plans (plan_date, type, created_by, order_type_id, status, store_id)
       VALUES (CURRENT_DATE, 'daily', $1, $2, 'in_progress', $3) RETURNING id`, [fx.userId, def, fx.storeId])).rows[0].id;
    ids.item = (await p().query(`INSERT INTO production_plan_items (plan_id, product_id, planned_quantity) VALUES ($1, $2, 40) RETURNING id`, [ids.plan, ids.product])).rows[0].id;
    ids.lot = (await p().query(
      `INSERT INTO product_lots (product_id, production_plan_id, plan_item_id, store_id, lot_number, quantity_total, backroom_qty)
       VALUES ($1, $2, $3, $4, $5, 40, 40) RETURNING id`, [ids.product, ids.plan, ids.item, fx.storeId, `PF${RUN}`])).rows[0].id;
  }, 60_000);

  afterAll(async () => {
    const run = async (sql: string, params: unknown[]) => { try { await p().query(sql, params); } catch { /* best effort */ } };
    await run(`DELETE FROM product_lots WHERE production_plan_id = $1`, [ids.plan]);
    await run(`DELETE FROM stock_locations WHERE store_id = $1`, [fx.storeId]);
    await run(`DELETE FROM production_plans WHERE id = $1`, [ids.plan]);
    await run(`DELETE FROM products WHERE id = $1`, [ids.product]);
    await run(`DELETE FROM users WHERE id = $1`, [fx.userId]);
    await run(`DELETE FROM stores WHERE id = $1`, [fx.storeId]);
    await closeTestPool();
  }, 60_000);

  it('sans emplacement défini : message clair, rien de rangé', async () => {
    const r = await apply(30, 5);
    expect(r.moved).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/Aucun emplacement « Magasin » \(code MAGASIN\).*Stock › Emplacements/);
    expect(r.warnings.join(' ')).toMatch(/Aucun emplacement « Frigo »/);
    expect(await split()).toEqual({});
  });

  it('rendement : rangé dans Magasin et Frigo, mouvements tracés ; ressaisie = écart seulement', async () => {
    for (const [code, name, type] of [['MAGASIN', 'Magasin', 'vitrine'], ['FRIGO', 'Frigo', 'positif']]) {
      await p().query(`INSERT INTO stock_locations (store_id, code, name, type) VALUES ($1, $2, $3, $4)`, [fx.storeId, code, name, type]);
    }
    const r = await apply(30, 5);
    expect(r.warnings).toEqual([]);
    expect(await split()).toEqual({ MAGASIN: 30, FRIGO: 5 });
    // Ressaisie : 28 vers le magasin (−2), 5 vers le frigo (inchangé).
    await apply(28, 5, { magasin: 30, frigo: 5 });
    expect(await split()).toEqual({ MAGASIN: 28, FRIGO: 5 });
    const moves = (await p().query(
      `SELECT m.quantite::float8 AS q, m.motif, f.code AS de, t.code AS vers FROM stock_location_moves m
         LEFT JOIN stock_locations f ON f.id = m.from_location_id LEFT JOIN stock_locations t ON t.id = m.to_location_id
        WHERE m.product_lot_id = $1 ORDER BY m.moved_at, m.created_at, m.quantite DESC`, [ids.lot])).rows;
    expect(moves).toEqual([
      { q: 30, motif: 'production', de: null, vers: 'MAGASIN' },
      { q: 5, motif: 'production', de: null, vers: 'FRIGO' },
      { q: 2, motif: 'correction', de: 'MAGASIN', vers: null },
    ]);
  });

  it('transfert magasin → frigo tracé ; quantité insuffisante refusée', async () => {
    const loc = async (code: string) => (await p().query(`SELECT id FROM stock_locations WHERE store_id = $1 AND code = $2`, [fx.storeId, code])).rows[0].id;
    const [mag, fri] = [await loc('MAGASIN'), await loc('FRIGO')];
    await repo.move({ productLotId: ids.lot, fromLocationId: mag, toLocationId: fri, quantity: 8, motif: 'transfert', userId: fx.userId });
    expect(await split()).toEqual({ MAGASIN: 20, FRIGO: 13 });
    await expect(repo.move({ productLotId: ids.lot, fromLocationId: fri, toLocationId: mag, quantity: 14, motif: 'transfert', userId: fx.userId }))
      .rejects.toThrow(/insuffisante/);
    // Part non rangée : 40 − 33 = 7 ; en ranger 8 est refusé.
    await expect(repo.move({ productLotId: ids.lot, fromLocationId: null, toLocationId: mag, quantity: 8, motif: 'production', userId: fx.userId }))
      .rejects.toThrow(/non rangée insuffisante/);
    expect((await repo.lotLocations(ids.lot))?.unplaced).toBe(7);
  });

  it('vente : la part rangée baisse (vitrine d\'abord), sans mouvement ; invariant respecté', async () => {
    const before = (await p().query(`SELECT COUNT(*)::int AS n FROM stock_location_moves WHERE product_lot_id = $1`, [ids.lot])).rows[0].n;
    // 40 → 10 en réserve : 30 vendus ; 33 rangés → 23 à retirer, le magasin (vitrine) d'abord.
    await p().query(`UPDATE product_lots SET backroom_qty = 10, sold_qty = 30 WHERE id = $1`, [ids.lot]);
    expect(await split()).toEqual({ FRIGO: 10 });
    expect((await p().query(`SELECT COUNT(*)::int AS n FROM stock_location_moves WHERE product_lot_id = $1`, [ids.lot])).rows[0].n).toBe(before);
    expect(await repo.balanceMismatches()).toEqual([]);
  });
});
