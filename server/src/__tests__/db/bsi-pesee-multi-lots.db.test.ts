/**
 * Scenario 2, constat 142 — pesee d'une ligne de bon sur plusieurs lots (FEFO).
 *
 * Avant correctif : une ligne ne puisait que dans UN lot. Quand le lot propose ne
 * couvrait plus la pesee et qu'aucun autre lot ne la couvrait a lui seul, la pesee etait
 * refusee « le lot … ne couvre pas la pesee » (400+ refus : fraises, creme, farines).
 *
 * Besoin 0,5 kg ; lot A 0,6 kg en economat a la generation -> une ligne « a ouvrir »
 * sur A. Avant la pesee, A n'a plus que 0,3 kg (consomme ailleurs) et un lot B de
 * 0,3 kg arrive. Le magasinier choisit explicitement A et pese 0,5 kg :
 *   -> 0,3 kg pris sur A + 0,2 kg complete sur B (detail par lot, mig 626) ;
 *   -> a la remise, chaque lot est decremente de sa part, et production_lot_usage
 *      (tracabilite / rappel de lot) voit les deux lots.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, createProductWithRecipe, cleanupFixtures,
  num, type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('BSI — pesee multi-lots FEFO (scenario 2, constat 142)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fx: Fixtures;
  let fraiseId: string;
  let lotA: string; let lotB: string;
  let planId: string; let bonId: string; let ligneId: string;

  beforeAll(async () => {
    repos = await importRepositories();
    fx = await createBaseFixtures();
    fraiseId = await createIngredient(fx, { name: 'Fraise', unit: 'kg', unitCost: 30 });
    lotA = await createLot(fx, { ingredientId: fraiseId, lotNumber: 'FR-A', pesage: 0, economat: 0.6, expiresInDays: 3, unitCost: 30 });
    const pr = await createProductWithRecipe(fx, {
      name: 'Tarte fraise', price: 25, shelfLifeDays: null,
      ingredients: [{ ingredientId: fraiseId, quantity: 0.5, unit: 'kg' }],
    });
    const plan = await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId: pr.productId, plannedQuantity: 1 }],
    });
    planId = plan.id; fx.ids.plans.push(planId);
    await repos.productionRepository.confirm(planId, fx.userId);
    const bon = (await repos.bonSortieRepository.findByPlan(planId))[0];
    bonId = bon.id;
    const lines = bon.lines.filter((l: Record<string, unknown>) => l.ingredient_id === fraiseId);
    expect(lines).toHaveLength(1);
    expect(lines[0].source_location).toBe('ECONOMAT_REQUIRES_TRANSFER');
    expect(lines[0].suggested_economat_lot_id).toBe(lotA);
    ligneId = lines[0].id;

    // Entre la generation et la pesee : A entame ailleurs (0,3 kg restant), reappro dans B.
    await testPool().query(`UPDATE ingredient_lots SET economat_quantity = 0.3 WHERE id = $1`, [lotA]);
    lotB = await createLot(fx, { ingredientId: fraiseId, lotNumber: 'FR-B', pesage: 0, economat: 0.3, expiresInDays: 6, unitCost: 32 });
    await repos.bonSortieRepository.markAsPreparation(bonId, fx.userId);
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('lot A choisi, insuffisant : la pesee est completee sur B au lieu d\'etre refusee', async () => {
    const row: Record<string, any> = await repos.bonSortieRepository.updateLigne(ligneId, 0.5, fx.userId, { lotId: lotA, source: 'manual' });
    expect(row.status).toBe('preleve');
    expect(num(row.actual_quantity)).toBeCloseTo(0.5, 3);
    expect(row.ingredient_lot_id).toBe(lotA);
    expect(row.notes).toMatch(/multi-lots/);
    expect(row.lots).toHaveLength(2);

    const parts = await testPool().query(
      `SELECT ingredient_lot_id, quantity FROM production_bons_sortie_ligne_lots WHERE ligne_id = $1`, [ligneId]);
    const byLot = Object.fromEntries(parts.rows.map(r => [r.ingredient_lot_id, num(r.quantity)]));
    expect(byLot[lotA]).toBeCloseTo(0.3, 4);
    expect(byLot[lotB]).toBeCloseTo(0.2, 4);

    // Les deux contenants sont ouverts (economat -> pesage), rien n'est encore sorti du stock.
    const lots = await testPool().query(
      `SELECT id, economat_quantity, pesage_quantity FROM ingredient_lots WHERE id = ANY($1)`, [[lotA, lotB]]);
    const a = lots.rows.find(r => r.id === lotA); const b = lots.rows.find(r => r.id === lotB);
    expect(num(a.economat_quantity) + num(a.pesage_quantity)).toBeCloseTo(0.3, 4);
    expect(num(b.economat_quantity) + num(b.pesage_quantity)).toBeCloseTo(0.3, 4);
    expect(num(b.pesage_quantity)).toBeGreaterThanOrEqual(0.2 - 1e-9);
  });

  it('repeser la ligne reecrit le detail (pas de doublon)', async () => {
    await repos.bonSortieRepository.updateLigne(ligneId, 0.5, fx.userId, { source: 'manual' });
    const parts = await testPool().query(
      `SELECT COUNT(*)::int AS n, SUM(quantity) AS total FROM production_bons_sortie_ligne_lots WHERE ligne_id = $1`, [ligneId]);
    expect(parts.rows[0].n).toBe(2);
    expect(num(parts.rows[0].total)).toBeCloseTo(0.5, 4);
  });

  it('remise : chaque lot sort de sa part, la tracabilite voit les deux lots', async () => {
    await repos.bonSortieRepository.markAsReady(bonId, fx.userId);
    const closed = await repos.bonSortieRepository.acceptReception(bonId, fx.userId);
    expect(closed.status).toBe('cloture');

    const lots = await testPool().query(
      `SELECT id, status, economat_quantity + pesage_quantity AS qty FROM ingredient_lots WHERE id = ANY($1)`, [[lotA, lotB]]);
    const a = lots.rows.find(r => r.id === lotA); const b = lots.rows.find(r => r.id === lotB);
    expect(num(a.qty)).toBeCloseTo(0, 4);
    expect(a.status).toBe('depleted');
    expect(num(b.qty)).toBeCloseTo(0.1, 4);

    const usage = await testPool().query(
      `SELECT ingredient_lot_id, quantity_used FROM production_lot_usage WHERE production_plan_id = $1 AND bon_ligne_id = $2`,
      [planId, ligneId]);
    const used = Object.fromEntries(usage.rows.map(r => [r.ingredient_lot_id, num(r.quantity_used)]));
    expect(Object.keys(used)).toHaveLength(2);
    expect(used[lotA]).toBeCloseTo(0.3, 4);
    expect(used[lotB]).toBeCloseTo(0.2, 4);

    // Aucun manque trace : le stock couvrait la pesee.
    const anomalies = await testPool().query(`SELECT COUNT(*)::int AS n FROM stock_anomalies WHERE store_id = $1`, [fx.storeId]);
    expect(anomalies.rows[0].n).toBe(0);
  });
});
