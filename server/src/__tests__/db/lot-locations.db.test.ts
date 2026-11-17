/**
 * M6-02 — stock par lot et par emplacement (mig 570).
 *  - un lot 8 kg économat + 2 kg pesage est réparti sur « Économat » et « Zone de pesage » ;
 *  - un transfert économat → pesage (3 kg) met à jour la répartition et trace un mouvement
 *    entre emplacements ; une consommation au pesage ne trace pas de mouvement ;
 *  - un lot rangé dans un autre emplacement y porte sa part économat ;
 *  - invariant global : Σ emplacements = zones = quantité restante, pour tous les lots.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, createLot, cleanupFixtures, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Stock par emplacement (M6-02)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let sl: typeof import('../../repositories/stock-location.repository.js')['stockLocationRepository'];
  let fx: Fixtures; let lotId: string;
  const p = () => testPool();
  const split = async () => Object.fromEntries((await sl.lotLocations(lotId)).map((r: Record<string, any>) => [r.code, r.quantity]));

  beforeAll(async () => {
    repos = await importRepositories();
    sl = (await import('../../repositories/stock-location.repository.js')).stockLocationRepository;
    fx = await createBaseFixtures();
    for (const [code, name, type] of [['ECONOMAT', 'Économat (sec)', 'sec'], ['PESAGE', 'Zone de pesage', 'pesage'], ['FRIGO', 'Frigo', 'positif']]) {
      await p().query(`INSERT INTO stock_locations (store_id, code, name, type) VALUES ($1, $2, $3, $4) ON CONFLICT (store_id, code) DO NOTHING`, [fx.storeId, code, name, type]);
    }
    const ing = await createIngredient(fx, { name: 'Sucre M602', unit: 'kg', unitCost: 8 });
    lotId = await createLot(fx, { ingredientId: ing, lotNumber: 'M602', pesage: 2, economat: 8, expiresInDays: 60, unitCost: 8 });
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('répartition initiale sur économat et pesage', async () => {
    expect(await split()).toEqual({ ECONOMAT: 8, PESAGE: 2 });
  });

  it('transfert économat → pesage tracé, consommation non tracée comme mouvement', async () => {
    await p().query(`UPDATE ingredient_lots SET economat_quantity = economat_quantity - 3, pesage_quantity = pesage_quantity + 3 WHERE id = $1`, [lotId]);
    expect(await split()).toEqual({ ECONOMAT: 5, PESAGE: 5 });
    await p().query(`UPDATE ingredient_lots SET pesage_quantity = pesage_quantity - 1 WHERE id = $1`, [lotId]);
    expect(await split()).toEqual({ ECONOMAT: 5, PESAGE: 4 });
    const moves = (await p().query(`SELECT quantite::float8 AS q, motif FROM stock_location_moves WHERE ingredient_lot_id = $1`, [lotId])).rows;
    expect(moves).toEqual([{ q: 3, motif: 'transfert' }]);
  });

  it('lot rangé au frigo : la part économat y est portée', async () => {
    const frigo = (await p().query(`SELECT id FROM stock_locations WHERE store_id = $1 AND code = 'FRIGO'`, [fx.storeId])).rows[0].id;
    await p().query(`UPDATE ingredient_lots SET location_id = $2 WHERE id = $1`, [lotId, frigo]);
    expect(await split()).toEqual({ FRIGO: 5, PESAGE: 4 });
  });

  it('invariant : aucun lot déséquilibré', async () => {
    expect(await sl.balanceMismatches()).toEqual([]);
  });
});
