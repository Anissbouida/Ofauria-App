/**
 * Magasin générique (plan d'exécution multi-industries, étape 8).
 *
 * Tâche 1 (mig 642) : emplacements typés par rôle ; un emplacement par défaut par rôle et par
 * établissement ; la réception range dans la réserve par défaut.
 * Tâche 2 (mig 643) : les emplacements sont la source écrite ; les zones du lot en sont
 * dérivées ; un lot peut être réparti sur plus de deux emplacements sans que les écritures
 * historiques n'effacent la part rangée ailleurs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, createLot, cleanupFixtures, type Fixtures } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe.skipIf(!hasTestDb)('Étape 8 — magasin générique', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let sl: any;
  let fx: Fixtures;
  const p = () => testPool();
  const locOf = async (role: string) => (await p().query(`SELECT fn_store_location($1::uuid, $2::text) AS id`, [fx.storeId, role])).rows[0].id as string | null;

  beforeAll(async () => {
    repos = await importRepositories();
    sl = (await import('../../repositories/stock-location.repository.js')).stockLocationRepository;
    fx = await createBaseFixtures();
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx);
    await p().query(`DELETE FROM stock_locations WHERE store_id = $1`, [fx?.storeId]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('tâche 1 : le rôle se déduit du code historique ou du type', async () => {
    const rows = (await p().query(
      `INSERT INTO stock_locations (store_id, code, name, type) VALUES
         ($1, 'ECONOMAT', 'Économat', 'sec'), ($1, 'PESAGE', 'Pesage', 'pesage'), ($1, 'CH-NEG', 'Chambre négative', 'negatif'),
         ($1, 'VIT-1', 'Vitrine', 'vitrine')
       ON CONFLICT (store_id, code) DO NOTHING RETURNING code, role`, [fx.storeId])).rows;
    const by = Object.fromEntries(rows.map(r => [r.code, r.role]));
    expect(by).toMatchObject({ ECONOMAT: 'reserve', PESAGE: 'en_cours_ouvert', 'CH-NEG': 'froid_negatif', 'VIT-1': 'vente' });
  });

  it('tâche 1 : un emplacement par défaut par rôle ; le nouveau « par défaut » remplace l\'ancien', async () => {
    const eco = (await p().query(`SELECT id FROM stock_locations WHERE store_id = $1 AND code = 'ECONOMAT'`, [fx.storeId])).rows[0].id;
    expect(await locOf('reserve')).toBe(eco);
    // Un premier emplacement d'un rôle sans défaut devient celui par défaut.
    const q = await sl.create({ storeId: fx.storeId, code: 'QUAR', name: 'Quarantaine', type: 'sec', role: 'quarantaine' });
    expect(q).toMatchObject({ role: 'quarantaine', role_default: true });
    // Réserve demandée « par défaut » : elle remplace l'Économat.
    const res2 = await sl.create({ storeId: fx.storeId, code: 'RES-2', name: 'Réserve 2', type: 'sec', roleDefault: true });
    expect(res2.role_default).toBe(true);
    expect(await locOf('reserve')).toBe(res2.id);
    const n = (await p().query(`SELECT count(*)::int AS n FROM stock_locations WHERE store_id = $1 AND role = 'reserve' AND role_default`, [fx.storeId])).rows[0].n;
    expect(n).toBe(1);
    await sl.update(eco, { roleDefault: true });
    expect(await locOf('reserve')).toBe(eco);
  });

  it('tâche 1 : un lot reçu est rangé dans la réserve par défaut (sa part économat y est portée)', async () => {
    const ing = await createIngredient(fx, { name: 'Sucre E8', unit: 'kg', unitCost: 8 });
    const lot = await createLot(fx, { ingredientId: ing, lotNumber: 'E8-1', economat: 5, pesage: 0, expiresInDays: 60, unitCost: 8 });
    const split = (await p().query(
      `SELECT sl.role, ll.quantity::float8 AS q FROM ingredient_lot_locations ll JOIN stock_locations sl ON sl.id = ll.location_id
        WHERE ll.ingredient_lot_id = $1 AND ll.quantity > 0`, [lot])).rows;
    expect(split).toEqual([{ role: 'reserve', q: 5 }]);
  });

  const lotSplit = async (lot: string) => Object.fromEntries((await p().query(
    `SELECT sl.code, ll.quantity::float8 AS q FROM ingredient_lot_locations ll JOIN stock_locations sl ON sl.id = ll.location_id
      WHERE ll.ingredient_lot_id = $1 AND ll.quantity > 0`, [lot])).rows.map(r => [r.code, r.q]));
  const zones = async (lot: string) => (await p().query(
    `SELECT economat_quantity::float8 AS eco, pesage_quantity::float8 AS pes, quantity_remaining::float8 AS rest FROM ingredient_lots WHERE id = $1`, [lot])).rows[0];

  it('tâche 2 : ouverture, perte et retour écrits sur les emplacements ; zones dérivées', async () => {
    const lots = (await import('../../repositories/ingredient-lot.repository.js')).ingredientLotRepository as any;
    const ing = await createIngredient(fx, { name: 'Farine E8', unit: 'kg', unitCost: 2 });
    const lot = await createLot(fx, { ingredientId: ing, lotNumber: 'E8-2', economat: 10, pesage: 0, expiresInDays: 60, unitCost: 2 });
    await lots.openToPesage(lot, 4, fx.userId);
    expect(await lotSplit(lot)).toEqual({ ECONOMAT: 6, PESAGE: 4 });
    expect(await zones(lot)).toEqual({ eco: 6, pes: 4, rest: 10 });
    await lots.wasteFromPesage(lot, 1, fx.userId, 'Sac renversé');
    await lots.returnToEconomat(lot, 1, fx.userId);
    expect(await lotSplit(lot)).toEqual({ ECONOMAT: 7, PESAGE: 2 });
    expect(await zones(lot)).toEqual({ eco: 7, pes: 2, rest: 9 });
    const moves = (await p().query(`SELECT motif, quantite::float8 AS q FROM stock_location_moves WHERE ingredient_lot_id = $1 ORDER BY moved_at, created_at`, [lot])).rows;
    expect(moves).toEqual([{ motif: 'transfert', q: 4 }, { motif: 'retour', q: 1 }]);
  });

  it('tâche 2 : une part rangée dans un troisième emplacement survit aux écritures historiques', async () => {
    const ing = await createIngredient(fx, { name: 'Beurre E8', unit: 'kg', unitCost: 9 });
    const lot = await createLot(fx, { ingredientId: ing, lotNumber: 'E8-3', economat: 10, pesage: 0, expiresInDays: 30, unitCost: 9 });
    const froid = (await p().query(
      `INSERT INTO stock_locations (store_id, code, name, type) VALUES ($1, 'CF-1', 'Chambre froide', 'positif') RETURNING id`, [fx.storeId])).rows[0].id;
    // Rangement de 4 kg en chambre froide : mouvement réserve → froid écrit sur les emplacements.
    await p().query(`SELECT fn_lot_take($1::uuid, 4, 'reserve', false)`, [lot]);
    await p().query(`SELECT fn_lot_location_add($1::uuid, $2::uuid, 4)`, [lot, froid]);
    await p().query(`SELECT fn_lot_recompute_zones($1::uuid)`, [lot]);
    expect(await lotSplit(lot)).toEqual({ ECONOMAT: 6, 'CF-1': 4 });
    expect(await zones(lot)).toMatchObject({ eco: 10, pes: 0 });
    // Écriture historique sur la zone (−2 en réserve) : appliquée en écart, la part froide reste.
    await p().query(`UPDATE ingredient_lots SET economat_quantity = economat_quantity - 2 WHERE id = $1`, [lot]);
    expect(await lotSplit(lot)).toEqual({ ECONOMAT: 4, 'CF-1': 4 });
    // Une sortie plus grande que l'économat puise ensuite dans la chambre froide.
    await p().query(`SELECT fn_lot_take($1::uuid, 6, 'reserve')`, [lot]);
    expect(await lotSplit(lot)).toEqual({ 'CF-1': 2 });
    expect(await zones(lot)).toEqual({ eco: 2, pes: 0, rest: 2 });
    await expect(p().query(`SELECT fn_lot_take($1::uuid, 5, 'reserve')`, [lot])).rejects.toThrow(/STOCK_EMPLACEMENT_INSUFFISANT/);
  });

  it('tâche 2 : invariant global — Σ emplacements = zones = quantité restante, pour tous les lots', async () => {
    const r = (await p().query(
      `SELECT count(*)::int AS n FROM v_lot_location_balance b JOIN ingredient_lots il ON il.id = b.ingredient_lot_id
        WHERE il.store_id IS NOT NULL AND (abs(b.zones_total - b.locations_total) > 0.0001 OR abs(b.quantity_remaining - b.zones_total) > 0.0001)`)).rows[0];
    expect(r.n).toBe(0);
  });
});
