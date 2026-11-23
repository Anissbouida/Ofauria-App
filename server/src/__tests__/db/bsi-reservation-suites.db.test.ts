/**
 * Scenario 2, suites du constat 141 — « Re-verifier dispo » et l'ouverture depuis
 * l'economat tiennent compte des quantites promises aux AUTRES bons ouverts.
 *
 * 1. Ouverture d'un contenant (transferLineFromEconomat) : quand le lot suggere ne
 *    couvre plus la ligne, le repli prend le premier lot dont l'economat LIBRE couvre
 *    la quantite. Avant : le premier lot dont l'economat BRUT la couvrait, quitte a
 *    ouvrir le sac deja promis a un autre bon.
 *    Farine : A 1 kg (J+3), B 1 kg (J+8), C 1 kg (J+12), en economat.
 *      bon 1 (0,8) -> A 0,8 ; bon 2 (0,8) -> A 0,2 + B 0,6.
 *      A tombe a 0,5 kg (consommation hors bon). Ouverture du bon 1 (0,8) :
 *      A libre 0,3, B libre 0,4 -> C (avant : B, promis au bon 2).
 *
 * 2. Re-verification (completePending) : le pesage libre d'un lot deduit les lignes de
 *    tous les bons ouverts. Avant : seulement celles du bon re-verifie.
 *    Sucre : P 1 kg au pesage. bon X (0,8) -> P 0,8 ; bon Y (0,8) -> P 0,2 + rupture 0,6.
 *      Re-verifier Y : P n'a plus rien de libre -> la rupture reste (avant : 0,6 de plus
 *      sur P, soit 1,6 kg promis sur un lot de 1 kg). Un lot Q arrive au pesage :
 *      re-verifier Y sert les 0,6 kg sur Q.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, createProductWithRecipe, cleanupFixtures,
  num, type Fixtures,
} from './helpers.js';

type Line = Record<string, any>;

describe.skipIf(!hasTestDb)('BSI — suites du constat 141 (ouverture economat, re-verification)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fx: Fixtures;
  let farineId: string; let sucreId: string;
  let lotA: string; let lotB: string; let lotC: string; let lotP: string;
  let painId: string; let gateauId: string;

  const planAndBon = async (productId: string) => {
    const plan = await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId, plannedQuantity: 1 }],
    });
    fx.ids.plans.push(plan.id);
    await repos.productionRepository.confirm(plan.id, fx.userId);
    return (await repos.bonSortieRepository.findByPlan(plan.id))[0] as { id: string; lines: Line[] };
  };
  const linesOf = async (bonId: string, ingredientId: string) => (await testPool().query(
    `SELECT * FROM production_bons_sortie_lignes WHERE bon_id = $1 AND ingredient_id = $2 AND status <> 'annule'`,
    [bonId, ingredientId])).rows as Line[];

  beforeAll(async () => {
    repos = await importRepositories();
    fx = await createBaseFixtures();
    farineId = await createIngredient(fx, { name: 'Farine T65', unit: 'kg', unitCost: 6 });
    sucreId = await createIngredient(fx, { name: 'Sucre semoule', unit: 'kg', unitCost: 9 });
    lotA = await createLot(fx, { ingredientId: farineId, lotNumber: 'F-A', pesage: 0, economat: 1, expiresInDays: 3, unitCost: 6 });
    lotB = await createLot(fx, { ingredientId: farineId, lotNumber: 'F-B', pesage: 0, economat: 1, expiresInDays: 8, unitCost: 6 });
    lotC = await createLot(fx, { ingredientId: farineId, lotNumber: 'F-C', pesage: 0, economat: 1, expiresInDays: 12, unitCost: 6 });
    lotP = await createLot(fx, { ingredientId: sucreId, lotNumber: 'S-P', pesage: 1, economat: 0, expiresInDays: 30, unitCost: 9 });
    painId = (await createProductWithRecipe(fx, {
      name: 'Pain de campagne', price: 5, shelfLifeDays: null,
      ingredients: [{ ingredientId: farineId, quantity: 0.8, unit: 'kg' }],
    })).productId;
    gateauId = (await createProductWithRecipe(fx, {
      name: 'Quatre-quarts', price: 40, shelfLifeDays: null,
      ingredients: [{ ingredientId: sucreId, quantity: 0.8, unit: 'kg' }],
    })).productId;
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('ouverture economat : le repli ne prend pas le sac promis a un autre bon', async () => {
    const bon1 = await planAndBon(painId);
    const bon2 = await planAndBon(painId);
    const l1 = (await linesOf(bon1.id, farineId))[0];
    expect(l1.suggested_economat_lot_id).toBe(lotA);
    const byLot2 = Object.fromEntries((await linesOf(bon2.id, farineId)).map(l => [l.suggested_economat_lot_id, num(l.transfer_required_qty)]));
    expect(byLot2[lotB]).toBeCloseTo(0.6, 4);

    await testPool().query(`UPDATE ingredient_lots SET economat_quantity = 0.5 WHERE id = $1`, [lotA]);
    await repos.bonSortieRepository.markAsPreparation(bon1.id, fx.userId);
    const moved: Line = await repos.bonSortieRepository.transferLineFromEconomat(l1.id, fx.userId);
    expect(moved.ingredient_lot_id).toBe(lotC);
    const lots = await testPool().query(
      `SELECT id, economat_quantity, pesage_quantity FROM ingredient_lots WHERE id = ANY($1)`, [[lotB, lotC]]);
    const byId = Object.fromEntries(lots.rows.map(r => [r.id, r]));
    expect(num(byId[lotB].economat_quantity)).toBeCloseTo(1, 4);
    expect(num(byId[lotC].pesage_quantity)).toBeCloseTo(0.8, 4);
  });

  it('re-verification : pas de seconde promesse sur un lot deja promis a un autre bon', async () => {
    const bonX = await planAndBon(gateauId);
    const bonY = await planAndBon(gateauId);
    const lx = await linesOf(bonX.id, sucreId);
    expect(lx).toHaveLength(1);
    expect(lx[0].ingredient_lot_id).toBe(lotP);
    const ly = await linesOf(bonY.id, sucreId);
    expect(num(ly.find(l => l.ingredient_lot_id === lotP)?.allocated_quantity)).toBeCloseTo(0.2, 4);
    expect(ly.some(l => l.status === 'rupture')).toBe(true);

    await repos.bonSortieRepository.markAsPreparation(bonY.id, fx.userId);
    await repos.bonSortieRepository.completePending(bonY.id, fx.userId);
    const after = await linesOf(bonY.id, sucreId);
    const onP = after.filter(l => l.ingredient_lot_id === lotP && l.source_location === 'PESAGE')
      .reduce((s, l) => s + num(l.allocated_quantity), 0);
    expect(onP).toBeCloseTo(0.2, 4);
    expect(after.some(l => l.status === 'rupture')).toBe(true);

    const lotQ = await createLot(fx, { ingredientId: sucreId, lotNumber: 'S-Q', pesage: 1, economat: 0, expiresInDays: 40, unitCost: 9 });
    await repos.bonSortieRepository.completePending(bonY.id, fx.userId);
    const final = await linesOf(bonY.id, sucreId);
    const onQ = final.filter(l => l.ingredient_lot_id === lotQ).reduce((s, l) => s + num(l.allocated_quantity), 0);
    expect(onQ).toBeCloseTo(0.6, 4);
    expect(final.some(l => l.status === 'rupture')).toBe(false);
  });
});
