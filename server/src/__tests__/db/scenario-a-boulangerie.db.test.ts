/**
 * SCÉNARIO A — parcours boulangerie de référence (plan d'exécution multi-industries, étape 0).
 *
 * Filet de non-régression du chantier « production multi-industries » : il fige le parcours
 * réel d'Ofauria, de l'ouverture d'un sac à l'Économat jusqu'à la réception en boutique.
 * Toute étape du plan (catalogue de capacités, héritage, gel de configuration, moteur de
 * processus, magasin générique…) doit le laisser vert sans modification.
 *
 *   1. Sac de farine fermé à l'Économat (25 kg), ouvert et transféré au Pesage.
 *   2. Plan de 40 croissants (0,1 kg de farine chacun) → confirmation : besoin 4 kg,
 *      bon de sortie généré sur le lot ouvert (source PESAGE).
 *   3. Bon de sortie : prise en charge → pesée → remise → acceptation du chef :
 *      la farine sort UNE fois du Pesage (25 → 21), l'Économat ne bouge pas.
 *   4. Démarrage → déclaration de 40 : stock produit, lot de produit fini, plan terminé,
 *      pas de seconde déduction de farine.
 *   5. Coût réel : matière = 4 kg × 10 = 40.
 *   6. Transfert vers la boutique, reçu avec un manquant de 2 : le stock suit la quantité reçue.
 *   7. Journal des transitions du plan et du bon : l'ordre exact des états est figé.
 *
 * Fixtures commitées puis nettoyées (les dépôts ouvrent leurs propres connexions).
 */
process.env.POS_ALLOW_NEGATIVE_STOCK = 'off';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, createProductWithRecipe, cleanupFixtures,
  num, type Fixtures,
} from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe.skipIf(!hasTestDb)('Scénario A — boulangerie de bout en bout', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let lotRepo: any; let coutRepo: any;
  let fx: Fixtures;
  let farineId: string; let lotId: string; let productId: string;
  let planId: string; let planItemId: string; let bonId: string;
  let transferId: string;

  const lotRow = async () => (await testPool().query(
    `SELECT economat_quantity, pesage_quantity FROM ingredient_lots WHERE id = $1`, [lotId])).rows[0];
  const inventory = async () => num((await testPool().query(
    `SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [farineId, fx.storeId])).rows[0]?.current_quantity);

  beforeAll(async () => {
    repos = await importRepositories();
    lotRepo = (await import('../../repositories/ingredient-lot.repository.js')).ingredientLotRepository;
    coutRepo = (await import('../../repositories/production-cout.repository.js')).productionCoutRepository;
    fx = await createBaseFixtures();
    farineId = await createIngredient(fx, { name: 'Farine A', unit: 'kg', unitCost: 10, allergens: ['gluten'] });
    lotId = await createLot(fx, { ingredientId: farineId, lotNumber: 'SAC', pesage: 0, economat: 25, expiresInDays: 60, unitCost: 10 });
    const pr = await createProductWithRecipe(fx, {
      name: 'Croissant A', price: 4, shelfLifeDays: 1,
      ingredients: [{ ingredientId: farineId, quantity: 0.1, unit: 'kg' }],
    });
    productId = pr.productId;
  }, 60_000);

  afterAll(async () => {
    const p = testPool();
    const run = async (sql: string, params: unknown[]) => { try { await p.query(sql, params); } catch { /* best effort */ } };
    await run(`DELETE FROM production_transfer_items WHERE transfer_id IN (SELECT id FROM production_transfers WHERE plan_id = $1)`, [planId]);
    await run(`DELETE FROM production_transfers WHERE plan_id = $1`, [planId]);
    await run(`DELETE FROM ingredient_stock_zone_transfers WHERE ingredient_lot_id = $1`, [lotId]);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('1. Économat → Pesage : le sac ouvert passe entièrement au Pesage, mouvement tracé', async () => {
    expect(await inventory()).toBeCloseTo(25, 3);
    await lotRepo.openToPesage(lotId, 25, fx.userId, { reason: 'Ouverture du sac' });
    const lot = await lotRow();
    expect(num(lot.economat_quantity)).toBeCloseTo(0, 3);
    expect(num(lot.pesage_quantity)).toBeCloseTo(25, 3);
    const moves = await testPool().query(
      `SELECT from_zone, to_zone, quantity FROM ingredient_stock_zone_transfers WHERE ingredient_lot_id = $1`, [lotId]);
    expect(moves.rows).toHaveLength(1);
    expect(moves.rows[0].from_zone).toBe('ECONOMAT');
    expect(moves.rows[0].to_zone).toBe('PESAGE');
    expect(num(moves.rows[0].quantity)).toBeCloseTo(25, 3);
    // Un transfert de zone ne change pas le stock total.
    expect(await inventory()).toBeCloseTo(25, 3);
  });

  it('2. Plan de 40 croissants confirmé : besoin 4 kg, bon de sortie sur le lot ouvert', async () => {
    const plan = await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId, plannedQuantity: 40 }],
    });
    planId = plan.id; fx.ids.plans.push(planId);
    const { warnings } = await repos.productionRepository.confirm(planId, fx.userId);
    expect(warnings).toEqual([]);
    const needs = await testPool().query(
      `SELECT needed_quantity FROM production_ingredient_needs WHERE plan_id = $1 AND ingredient_id = $2`, [planId, farineId]);
    expect(num(needs.rows[0].needed_quantity)).toBeCloseTo(4, 3);
    const items = await testPool().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [planId]);
    planItemId = items.rows[0].id;

    const bons = await repos.bonSortieRepository.findByPlan(planId);
    expect(bons).toHaveLength(1);
    bonId = bons[0].id;
    const line = (bons[0].lines as any[]).find((l) => l.ingredient_id === farineId);
    expect(line.ingredient_lot_id).toBe(lotId);
    expect(line.source_location).toBe('PESAGE');
    expect(num(line.allocated_quantity)).toBeCloseTo(4, 3);
  });

  it('3. Bon de sortie pesé et accepté : la farine sort une fois du Pesage (25 → 21)', async () => {
    await repos.bonSortieRepository.markAsPreparation(bonId, fx.userId);
    const bon = (await repos.bonSortieRepository.findByPlan(planId))[0];
    const line = (bon.lines as any[]).find((l) => l.ingredient_id === farineId);
    await repos.bonSortieRepository.weighLignes(bonId, fx.userId, [
      { ligneId: line.id, actualQuantity: 4, source: 'manual' },
    ]);
    await repos.bonSortieRepository.markAsReady(bonId, fx.userId);
    const closed = await repos.bonSortieRepository.acceptReception(bonId, fx.userId);
    expect(closed.status).toBe('cloture');
    const lot = await lotRow();
    expect(num(lot.pesage_quantity)).toBeCloseTo(21, 3);
    expect(num(lot.economat_quantity)).toBeCloseTo(0, 3);
    expect(await inventory()).toBeCloseTo(21, 3);
  });

  it('4. Déclaration de 40 : stock produit, lot fini, plan terminé, aucune seconde déduction', async () => {
    await repos.productionRepository.start(planId, fx.userId);
    const res = await repos.productionRepository.produceItems(planId, [{ planItemId, actualQuantity: 40 }], fx.userId, fx.storeId);
    expect(res.autoCompleted).toBe(true);
    const stock = await testPool().query(
      `SELECT stock_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`, [productId, fx.storeId]);
    expect(num(stock.rows[0].stock_quantity)).toBeCloseTo(40, 3);
    const lots = await testPool().query(
      `SELECT quantity_total, status FROM product_lots WHERE production_plan_id = $1 AND product_id = $2`, [planId, productId]);
    expect(lots.rows).toHaveLength(1);
    expect(num(lots.rows[0].quantity_total)).toBeCloseTo(40, 3);
    expect(num((await lotRow()).pesage_quantity)).toBeCloseTo(21, 3);
    expect(await inventory()).toBeCloseTo(21, 3);
  });

  it('5. Coût réel : la matière vaut 4 kg × 10 = 40', async () => {
    const cost = await coutRepo.computePlanCost(planId);
    const matiere = num(cost.coutMatieres);
    expect(matiere).toBeCloseTo(40, 2);
  });

  it('6. Transfert vers la boutique reçu avec un manquant de 2 : le stock suit la quantité reçue', async () => {
    const t = await repos.productionRepository.createTransfer(planId, [planItemId], fx.userId, fx.storeId);
    transferId = t.id;
    const ti = await testPool().query(`SELECT id, transferred_quantity FROM production_transfer_items WHERE transfer_id = $1`, [transferId]);
    expect(num(ti.rows[0].transferred_quantity)).toBeCloseTo(40, 3);
    await repos.productionRepository.confirmTransferReception(transferId, [{ itemId: ti.rows[0].id, qtyReceived: 38, notes: 'deux abîmés' }], fx.userId);
    const stock = await testPool().query(
      `SELECT stock_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`, [productId, fx.storeId]);
    expect(num(stock.rows[0].stock_quantity)).toBeCloseTo(38, 3);
  });

  it('7. Journal : ordre exact des transitions du plan et du bon de sortie', async () => {
    const ev = await testPool().query(
      `SELECT entity, from_status, to_status FROM production_plan_events
        WHERE plan_id = $1 OR bon_id = $2 ORDER BY id`, [planId, bonId]);
    const plan = ev.rows.filter((r) => r.entity === 'plan').map((r) => `${r.from_status}>${r.to_status}`);
    const bon = ev.rows.filter((r) => r.entity === 'bon').map((r) => `${r.from_status}>${r.to_status}`);
    expect(plan).toEqual([
      'null>draft',
      'draft>confirmed',
      'confirmed>awaiting_ingredients',
      'awaiting_ingredients>ready_to_produce',
      'ready_to_produce>in_progress',
      'in_progress>completed',
    ]);
    expect(bon).toEqual([
      'null>genere',
      'genere>preparation',
      'preparation>pret',
      'pret>prelevement',
      'prelevement>verifie',
      'verifie>cloture',
    ]);
  });
});
