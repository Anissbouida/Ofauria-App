/**
 * F-069 / F-073 — Pesage multi-lots depuis l'economat.
 *
 * Avant correctif : quand le besoin d'un ingredient devait etre couvert par
 * l'economat mais qu'AUCUN lot ne le couvrait a lui seul (plusieurs fonds de
 * sac), generate() creait UNE seule ligne ECONOMAT_REQUIRES_TRANSFER pointant
 * sur un lot suggere trop petit. A la pesee, « le lot ne couvre pas la pesee »
 * etait leve et bloquait toute la production.
 *
 * Correctif : la part economat est eclatee en lignes FEFO, une par lot, chacune
 * portant une portion <= l'economat de SON lot. Chaque ligne s'ouvre alors sur
 * son propre lot et la pesee passe.
 *
 * Besoin 0,5 kg ; 3 lots de 0,2 kg en economat (pesage 0), meme DLC.
 *   -> 3 lignes ECONOMAT_REQUIRES_TRANSFER : 0,2 + 0,2 + 0,1 (somme = 0,5)
 *   -> pesee de chaque part OK -> reception cloturee -> stock -0,5 kg.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, createProductWithRecipe, cleanupFixtures,
  num, type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('BSI — eclatement FEFO de la part economat (F-069/F-073)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fx: Fixtures;
  let sucreId: string;
  const lotIds: string[] = [];
  let productId: string;
  let planId: string; let bonId: string;
  let inventoryBefore: number;

  beforeAll(async () => {
    repos = await importRepositories();
    fx = await createBaseFixtures();
    sucreId = await createIngredient(fx, { name: 'Sucre glace', unit: 'kg', unitCost: 8 });
    // 3 fonds de sac a l'economat (rien au pesage), meme DLC : aucun ne couvre
    // seul le besoin de 0,5 kg (0,2 chacun, total 0,6).
    for (const n of ['A', 'B', 'C']) {
      lotIds.push(await createLot(fx, {
        ingredientId: sucreId, lotNumber: `ECO-${n}`,
        pesage: 0, economat: 0.2, expiresInDays: 30, unitCost: 8,
      }));
    }
    const pr = await createProductWithRecipe(fx, {
      name: 'Macaron', price: 2, shelfLifeDays: null,
      ingredients: [{ ingredientId: sucreId, quantity: 0.5, unit: 'kg' }],
    });
    productId = pr.productId;
    const inv = await testPool().query(
      `SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`,
      [sucreId, fx.storeId]
    );
    inventoryBefore = num(inv.rows[0]?.current_quantity);
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('le trigger mig 114 a synchronise l\'inventaire a 0,6 kg (3 x 0,2 economat)', () => {
    expect(inventoryBefore).toBeCloseTo(0.6, 3);
  });

  it('confirm genere 3 lignes ECONOMAT_REQUIRES_TRANSFER (une par lot), aucune en rupture', async () => {
    const plan = await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId, plannedQuantity: 1 }],
    });
    planId = plan.id; fx.ids.plans.push(planId);
    await repos.productionRepository.confirm(planId, fx.userId);

    const bons = await repos.bonSortieRepository.findByPlan(planId);
    expect(bons).toHaveLength(1);
    const bon = bons[0];
    bonId = bon.id;

    const sucreLines = bon.lines.filter((l: Record<string, unknown>) => l.ingredient_id === sucreId);
    const economatLines = sucreLines.filter((l: Record<string, unknown>) => l.source_location === 'ECONOMAT_REQUIRES_TRANSFER');
    const ruptureLines = sucreLines.filter((l: Record<string, unknown>) => l.source_location === 'RUPTURE');

    // Le coeur du correctif : 3 lignes (plus 1 seule ligne trop grosse), aucune rupture.
    expect(economatLines).toHaveLength(3);
    expect(ruptureLines).toHaveLength(0);

    // Chaque ligne cible un lot DISTINCT et ne demande que ce que ce lot peut donner.
    const suggested = economatLines.map((l: Record<string, unknown>) => l.suggested_economat_lot_id);
    expect(new Set(suggested).size).toBe(3);
    for (const id of suggested) expect(lotIds).toContain(id);

    for (const l of economatLines) {
      const transfer = num(l.transfer_required_qty);
      // La portion demandee est couverte par l'economat de son lot (0,2).
      expect(transfer).toBeLessThanOrEqual(0.2 + 1e-9);
      expect(transfer).toBeGreaterThan(0);
    }
    // La somme des portions couvre exactement le besoin.
    const totalTransfer = economatLines.reduce((s: number, l: Record<string, unknown>) => s + num(l.transfer_required_qty), 0);
    expect(totalTransfer).toBeCloseTo(0.5, 3);
  });

  it('chaque part se pese sur son propre lot -> reception cloturee -> stock -0,5 kg', async () => {
    await repos.bonSortieRepository.markAsPreparation(bonId, fx.userId);

    const bon = (await repos.bonSortieRepository.findByPlan(planId))[0];
    const economatLines = bon.lines.filter(
      (l: Record<string, unknown>) => l.ingredient_id === sucreId && l.source_location === 'ECONOMAT_REQUIRES_TRANSFER'
    );
    // Pesee de chaque part a sa cible (transfer_required_qty) : avant le correctif,
    // la premiere de ces pesees levait « le lot ne couvre pas la pesee ».
    await repos.bonSortieRepository.weighLignes(
      bonId, fx.userId,
      economatLines.map((l: Record<string, unknown>) => ({
        ligneId: l.id as string, actualQuantity: num(l.transfer_required_qty), source: 'manual' as const,
      }))
    );

    await repos.bonSortieRepository.markAsReady(bonId, fx.userId);
    const closed = await repos.bonSortieRepository.acceptReception(bonId, fx.userId);
    expect(closed.status).toBe('cloture');

    // Stock matiere sorti UNE fois, 0,5 kg au total (0,6 - 0,5 = 0,1 restant).
    const inv = await testPool().query(
      `SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`,
      [sucreId, fx.storeId]
    );
    expect(num(inv.rows[0].current_quantity)).toBeCloseTo(0.1, 3);

    const lots = await testPool().query(
      `SELECT COALESCE(SUM(economat_quantity + pesage_quantity), 0) AS qty
         FROM ingredient_lots WHERE ingredient_id = $1 AND store_id = $2`,
      [sucreId, fx.storeId]
    );
    expect(num(lots.rows[0].qty)).toBeCloseTo(0.1, 3);
  });
});
