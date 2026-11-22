/**
 * Scenario 2, constat 141 — le lot propose a la generation d'un bon est reserve.
 *
 * Avant correctif : la generation comptait tout le stock d'un lot comme libre, meme
 * deja promis a un autre bon ouvert. Un bon genere juste apres (autre atelier, plan
 * enfant) comptait sur la meme quantite, la consommait, et la pesee du premier bon
 * etait refusee « Lot … non actif (depleted) » (142 refus sur six mois).
 *
 * Farine : lot A 1 kg (DLC J+3), B 0,5 kg (J+8), C 0,5 kg (J+12), tout en economat.
 * Deux plans de 0,8 kg chacun :
 *   - bon 1 : 0,8 kg sur A ;
 *   - bon 2 : A n'a plus que 0,2 kg libre -> 0,2 sur A + 0,5 sur B + 0,1 sur C
 *     (avant : 0,8 sur A, deja promis au bon 1).
 * Puis A est vide par une consommation hors bon (plan enfant, FEFO a la production) :
 *   - la pesee du bon 1 (0,8 kg, sans choix de lot) se reporte sur les lots suivants
 *     au lieu d'etre refusee ;
 *   - le bon 2 ne peut plus etre servi en entier : refus explicite (stock reellement
 *     insuffisant), pas de lot « depleted ».
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, createProductWithRecipe, cleanupFixtures,
  num, type Fixtures,
} from './helpers.js';

type Line = Record<string, any>;

describe.skipIf(!hasTestDb)('BSI — reservation des lots a la generation (scenario 2, constat 141)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fx: Fixtures;
  let farineId: string;
  let lotA: string; let lotB: string; let lotC: string;
  let productId: string;
  const plans: string[] = [];
  const bons: { id: string; lines: Line[] }[] = [];

  const farineLines = (b: { lines: Line[] }) => b.lines.filter(l => l.ingredient_id === farineId);
  const planAndBon = async () => {
    const plan = await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId, plannedQuantity: 1 }],
    });
    fx.ids.plans.push(plan.id); plans.push(plan.id);
    await repos.productionRepository.confirm(plan.id, fx.userId);
    const bon = (await repos.bonSortieRepository.findByPlan(plan.id))[0];
    bons.push(bon);
    return bon;
  };

  beforeAll(async () => {
    repos = await importRepositories();
    fx = await createBaseFixtures();
    farineId = await createIngredient(fx, { name: 'Farine T55', unit: 'kg', unitCost: 6 });
    lotA = await createLot(fx, { ingredientId: farineId, lotNumber: 'FA-A', pesage: 0, economat: 1, expiresInDays: 3, unitCost: 6 });
    lotB = await createLot(fx, { ingredientId: farineId, lotNumber: 'FA-B', pesage: 0, economat: 0.5, expiresInDays: 8, unitCost: 6 });
    lotC = await createLot(fx, { ingredientId: farineId, lotNumber: 'FA-C', pesage: 0, economat: 0.5, expiresInDays: 12, unitCost: 6 });
    productId = (await createProductWithRecipe(fx, {
      name: 'Baguette', price: 1.5, shelfLifeDays: null,
      ingredients: [{ ingredientId: farineId, quantity: 0.8, unit: 'kg' }],
    })).productId;
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('bon 1 : 0,8 kg sur le lot A (FEFO)', async () => {
    const bon = await planAndBon();
    const lines = farineLines(bon);
    expect(lines).toHaveLength(1);
    expect(lines[0].suggested_economat_lot_id).toBe(lotA);
    expect(num(lines[0].transfer_required_qty)).toBeCloseTo(0.8, 4);
  });

  it('bon 2 : ne compte pas sur la part de A deja promise au bon 1', async () => {
    const bon = await planAndBon();
    const lines = farineLines(bon);
    const byLot = Object.fromEntries(lines.map(l => [l.suggested_economat_lot_id, num(l.transfer_required_qty)]));
    expect(lines.every(l => l.source_location === 'ECONOMAT_REQUIRES_TRANSFER')).toBe(true);
    expect(byLot[lotA]).toBeCloseTo(0.2, 4);
    expect(byLot[lotB]).toBeCloseTo(0.5, 4);
    expect(byLot[lotC]).toBeCloseTo(0.1, 4);

    // Jamais plus que le lot sur l'ensemble des bons ouverts.
    const promised = await testPool().query(
      `SELECT COALESCE(SUM(transfer_required_qty), 0) AS q FROM production_bons_sortie_lignes
        WHERE suggested_economat_lot_id = $1 AND status = 'en_attente'`, [lotA]);
    expect(num(promised.rows[0].q)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('A vide hors bon : la pesee du bon 1 se reporte sur les lots suivants', async () => {
    // Plan enfant : consommation FEFO a la production, sans bon de sortie.
    await testPool().query(
      `UPDATE ingredient_lots SET economat_quantity = 0, pesage_quantity = 0, status = 'depleted' WHERE id = $1`, [lotA]);
    await repos.bonSortieRepository.markAsPreparation(bons[0].id, fx.userId);
    const ligne = farineLines(bons[0])[0];
    const row: Record<string, any> = await repos.bonSortieRepository.updateLigne(ligne.id, 0.8, fx.userId, { source: 'manual' });
    expect(row.status).toBe('preleve');
    expect(row.ingredient_lot_id).not.toBe(lotA);
    const parts = await testPool().query(
      `SELECT ingredient_lot_id, quantity FROM production_bons_sortie_ligne_lots WHERE ligne_id = $1`, [ligne.id]);
    const total = parts.rows.reduce((s, r) => s + num(r.quantity), 0);
    expect(total).toBeCloseTo(0.8, 4);
    expect(parts.rows.every(r => [lotB, lotC].includes(r.ingredient_lot_id))).toBe(true);
  });

  it('bon 2 : le stock ne suffit plus -> refus explicite, pas « Lot non actif »', async () => {
    await repos.bonSortieRepository.markAsPreparation(bons[1].id, fx.userId);
    const lineB = farineLines(bons[1]).find(l => l.suggested_economat_lot_id === lotB)!;
    await expect(
      repos.bonSortieRepository.updateLigne(lineB.id, 0.5, fx.userId, { source: 'manual' })
    ).rejects.toThrow(/ne couvrent pas la pesee/);
  });

  it('remise du bon 1 : B et C sortent chacun de leur part', async () => {
    await repos.bonSortieRepository.markAsReady(bons[0].id, fx.userId);
    const closed = await repos.bonSortieRepository.acceptReception(bons[0].id, fx.userId);
    expect(closed.status).toBe('cloture');
    const lots = await testPool().query(
      `SELECT SUM(economat_quantity + pesage_quantity) AS q FROM ingredient_lots WHERE id = ANY($1)`, [[lotB, lotC]]);
    expect(num(lots.rows[0].q)).toBeCloseTo(0.2, 4);
    const usage = await testPool().query(
      `SELECT SUM(quantity_used) AS q, COUNT(DISTINCT ingredient_lot_id)::int AS n
         FROM production_lot_usage WHERE production_plan_id = $1`, [plans[0]]);
    expect(num(usage.rows[0].q)).toBeCloseTo(0.8, 4);
    expect(usage.rows[0].n).toBe(2);
  });
});
