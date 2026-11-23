/**
 * Magasin générique (plan d'exécution multi-industries, étape 8).
 *
 * Tâche 1 (mig 642) : emplacements typés par rôle ; un emplacement par défaut par rôle et par
 * établissement ; la réception range dans la réserve par défaut.
 * Tâche 2 (mig 643) : les emplacements sont la source écrite ; les zones du lot en sont
 * dérivées ; un lot peut être réparti sur plus de deux emplacements sans que les écritures
 * historiques n'effacent la part rangée ailleurs.
 * Tâche 3 : plus de code d'emplacement en dur (constantes nommées, rôles).
 * Tâche 4 : sans la capacité « pesage », le bon de sortie sert directement depuis la réserve.
 * Tâche 5 (mig 644) : réservation de matière à la confirmation (capacité « reservation_matiere »).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, createLot, createProductWithRecipe, cleanupFixtures, num, type Fixtures } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe.skipIf(!hasTestDb)('Étape 8 — magasin générique', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let sl: any; let sectors: any; let savedOverrides: Record<string, boolean> = {};
  let fx: Fixtures;
  const p = () => testPool();
  const locOf = async (role: string) => (await p().query(`SELECT fn_store_location($1::uuid, $2::text) AS id`, [fx.storeId, role])).rows[0].id as string | null;

  beforeAll(async () => {
    repos = await importRepositories();
    sl = (await import('../../repositories/stock-location.repository.js')).stockLocationRepository;
    sectors = (await import('../../repositories/sector.repository.js')).sectorRepository;
    savedOverrides = { ...(await sectors.activation()).featureOverrides };
    fx = await createBaseFixtures();
  }, 60_000);

  afterAll(async () => {
    // Capacités remises comme avant le test (pesage, réservation de matière).
    await sectors?.applyAdjustments({ features: { pesage: savedOverrides.pesage ?? null, reservation_matiere: savedOverrides.reservation_matiere ?? null } }).catch(() => undefined);
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

  async function newPlan(productId: string, qty: number) {
    const plan = await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId, plannedQuantity: qty }],
    });
    fx.ids.plans.push(plan.id);
    return plan.id as string;
  }

  it('tâche 4 : sans « pesage », le bon de sortie sert directement depuis la réserve', async () => {
    const off = await sectors.applyAdjustments({ features: { pesage: false } });
    expect('error' in off).toBe(false);
    const ing = await createIngredient(fx, { name: 'Acier E8', unit: 'kg', unitCost: 3 });
    const lot = await createLot(fx, { ingredientId: ing, lotNumber: 'E8-4', economat: 20, pesage: 0, expiresInDays: 365, unitCost: 3 });
    const { productId } = await createProductWithRecipe(fx, { name: 'Pièce E8', price: 10, ingredients: [{ ingredientId: ing, quantity: 2, unit: 'kg' }] });
    const planId = await newPlan(productId, 3);
    await repos.productionRepository.confirm(planId, fx.userId);
    const bon = (await repos.bonSortieRepository.findByPlan(planId))[0];
    const lines = (await p().query(`SELECT source_location, ingredient_lot_id, allocated_quantity::float8 AS q FROM production_bons_sortie_lignes WHERE bon_id = $1`, [bon.id])).rows;
    expect(lines).toEqual([{ source_location: 'PESAGE', ingredient_lot_id: lot, q: 6 }]);
    await repos.bonSortieRepository.markAsPreparation(bon.id, fx.userId);
    const fresh = (await repos.bonSortieRepository.findByPlan(planId))[0];
    await repos.bonSortieRepository.weighLignes(bon.id, fx.userId, (fresh.lines as any[]).filter(l => num(l.allocated_quantity) > 0)
      .map(l => ({ ligneId: l.id, actualQuantity: num(l.allocated_quantity), source: 'manual' })));
    await repos.bonSortieRepository.markAsReady(bon.id, fx.userId);
    await repos.bonSortieRepository.acceptReception(bon.id, fx.userId);
    expect(await lotSplit(lot)).toEqual({ ECONOMAT: 14 });
    expect(await zones(lot)).toEqual({ eco: 14, pes: 0, rest: 14 });
    // Aucune ouverture de contenant : pas de mouvement vers l'en-cours.
    expect((await p().query(`SELECT count(*)::int AS n FROM stock_location_moves WHERE ingredient_lot_id = $1`, [lot])).rows[0].n).toBe(0);
    await sectors.applyAdjustments({ features: { pesage: savedOverrides.pesage ?? null } });
  });

  it('tâche 5 : réservation à la confirmation ; le second ordre ne compte pas sur le même stock', async () => {
    const on = await sectors.applyAdjustments({ features: { reservation_matiere: true } });
    expect('error' in on).toBe(false);
    const ing = await createIngredient(fx, { name: 'Vis E8', unit: 'kg', unitCost: 1 });
    await createLot(fx, { ingredientId: ing, lotNumber: 'E8-5', economat: 10, pesage: 0, expiresInDays: 365, unitCost: 1 });
    const { productId } = await createProductWithRecipe(fx, { name: 'Assemblage E8', price: 5, ingredients: [{ ingredientId: ing, quantity: 1, unit: 'kg' }] });
    const a = await newPlan(productId, 6);
    const b = await newPlan(productId, 6);
    const ra = await repos.productionRepository.confirm(a, fx.userId);
    expect(ra.warnings.join(' ')).not.toMatch(/Réservation partielle/);
    const rb = await repos.productionRepository.confirm(b, fx.userId);
    expect(rb.warnings.join(' ')).toMatch(/Réservation partielle : Vis E8.*4.*sur 6.*2 non couverts/);
    const free = (await p().query(`SELECT free::float8 AS free, reserved::float8 AS reserved FROM v_material_free_stock WHERE ingredient_id = $1 AND store_id = $2`, [ing, fx.storeId])).rows[0];
    expect(free).toEqual({ free: 0, reserved: 10 });
    // Garde « composants réservés » : l'ordre B est couvert en partie seulement.
    const { GUARDS } = await import('../../services/process-catalog.js');
    expect(await GUARDS.components_reserved.check({ planId: b })).toMatch(/réservés en partie/);
    expect(await GUARDS.components_reserved.check({ planId: a })).toBeNull();
    // Annulation (machine à états) : la réservation de B est libérée.
    const { transitionPlan } = await import('../../services/production-state.js');
    await transitionPlan(p() as any, b, 'cancelled');
    const st = (await p().query(`SELECT status FROM material_reservations WHERE plan_id = $1`, [b])).rows.map(r => r.status);
    expect(st).toEqual(['liberee']);
    expect((await p().query(`SELECT free::float8 AS free FROM v_material_free_stock WHERE ingredient_id = $1 AND store_id = $2`, [ing, fx.storeId])).rows[0].free).toBe(4);
    await sectors.applyAdjustments({ features: { reservation_matiere: savedOverrides.reservation_matiere ?? null } });
  });
});
