/**
 * Magasin générique (plan d'exécution multi-industries, étape 8).
 *
 * Tâche 1 (mig 642) : emplacements typés par rôle ; un emplacement par défaut par rôle et par
 * établissement ; la réception range dans la réserve par défaut.
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
});
