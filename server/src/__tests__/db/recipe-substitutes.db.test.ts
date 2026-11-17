/**
 * M4-05 — substituts d'article (mig 563).
 * Fiche : 0,2 kg de beurre par pièce, beurre sans stock ; substitut margarine, ratio 0,9.
 *  - la ligne du bon en rupture propose la margarine (1,8 kg pour 10 pièces, allergène ajouté : soja) ;
 *  - après bascule, la ligne pèse la margarine sur son lot ; la remise sort le stock de margarine
 *    et la traçabilité (production_lot_usage) porte le lot de margarine ;
 *  - les allergènes consommés de l'ordre incluent le soja, signalé comme ajouté ;
 *  - un substitut d'une autre fiche n'est pas proposé ; une ligne pesée ne se substitue plus.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, createLot, createProductWithRecipe, cleanupFixtures, num, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Substituts d\'article (M4-05)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let subs: typeof import('../../repositories/recipe-substitute.repository.js')['recipeSubstituteRepository'];
  let fx: Fixtures; let butter: string; let marg: string; let oil: string; let margLot: string; let recipeId: string; let otherRecipe: string;
  let planId: string; let bonId: string; let lineId: string; const subIds: string[] = [];
  const p = () => testPool();
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    repos = await importRepositories();
    subs = (await import('../../repositories/recipe-substitute.repository.js')).recipeSubstituteRepository;
    fx = await createBaseFixtures();
    butter = await createIngredient(fx, { name: 'Beurre M405', unit: 'kg', unitCost: 80, allergens: ['lait'] });
    marg = await createIngredient(fx, { name: 'Margarine M405', unit: 'kg', unitCost: 40, allergens: ['soja'] });
    oil = await createIngredient(fx, { name: 'Huile M405', unit: 'kg', unitCost: 20 });
    margLot = await createLot(fx, { ingredientId: marg, lotNumber: 'MARG-M405', pesage: 5, expiresInDays: 30, unitCost: 40 });
    await createLot(fx, { ingredientId: oil, lotNumber: 'HUILE-M405', pesage: 5, expiresInDays: 30, unitCost: 20 });
    const d = await createProductWithRecipe(fx, { name: 'Croissant M405', price: 3, ingredients: [{ ingredientId: butter, quantity: 0.2, unit: 'kg' }] });
    recipeId = d.recipeId;
    otherRecipe = (await createProductWithRecipe(fx, { name: 'Autre M405', price: 3, ingredients: [{ ingredientId: butter, quantity: 0.1, unit: 'kg' }] })).recipeId;
    subIds.push((await subs.create({ recipeId, ingredientId: butter, substituteIngredientId: marg, ratio: 0.9, priority: 1 }, fx.userId)).id);
    subIds.push((await subs.create({ recipeId: otherRecipe, ingredientId: butter, substituteIngredientId: oil, ratio: 0.8, priority: 1 }, fx.userId)).id);
    const pl = await repos.productionRepository.create({ planDate: today, type: 'daily', createdBy: fx.userId, storeId: fx.storeId, items: [{ productId: d.productId, plannedQuantity: 10 }] });
    planId = pl.id; fx.ids.plans.push(planId);
    await repos.productionRepository.confirm(planId, fx.userId);
    const bon = (await repos.bonSortieRepository.findByPlan(planId))[0];
    bonId = bon.id;
    lineId = bon.lines.find((l: Record<string, unknown>) => l.ingredient_id === butter).id;
  }, 60_000);

  afterAll(async () => {
    for (const id of subIds) await subs.remove(id).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('la ligne en rupture propose le substitut de sa fiche, pas celui d\'une autre fiche', async () => {
    const s = await subs.suggestionsForLine(lineId);
    expect(s.map(x => x.substitute_ingredient_id)).toEqual([marg]);
    expect(s[0].needed_quantity).toBeCloseTo(1.8, 3);
    expect(s[0].available).toBeCloseTo(5, 3);
    expect(s[0].allergens_added).toEqual(['soja']);
  });

  it('bascule, pesée et remise : lot, stock et traçabilité portent la margarine', async () => {
    await repos.bonSortieRepository.markAsPreparation(bonId, fx.userId);
    const r = await subs.substituteLine(lineId, subIds[0], fx.userId, 'Rupture de beurre');
    expect(r.line.ingredient_id).toBe(marg);
    expect(r.line.original_ingredient_id).toBe(butter);
    expect(num(r.line.needed_quantity)).toBeCloseTo(1.8, 3);
    expect(r.line.ingredient_lot_id).toBe(margLot);
    await repos.bonSortieRepository.weighLignes(bonId, fx.userId, [{ ligneId: lineId, actualQuantity: 1.8, source: 'manual' as const }]);
    await expect(subs.substituteLine(lineId, subIds[0], fx.userId, 'encore')).rejects.toThrow(/déjà pesée/);
    await repos.bonSortieRepository.markAsReady(bonId, fx.userId);
    expect((await repos.bonSortieRepository.acceptReception(bonId, fx.userId)).status).toBe('cloture');
    const lot = (await p().query(`SELECT pesage_quantity FROM ingredient_lots WHERE id = $1`, [margLot])).rows[0];
    expect(num(lot.pesage_quantity)).toBeCloseTo(3.2, 3);
    const usage = (await p().query(`SELECT ingredient_id, ingredient_lot_id, quantity_used FROM production_lot_usage WHERE production_plan_id = $1`, [planId])).rows;
    expect(usage).toHaveLength(1);
    expect(usage[0].ingredient_id).toBe(marg);
    expect(usage[0].ingredient_lot_id).toBe(margLot);
    expect(num(usage[0].quantity_used)).toBeCloseTo(1.8, 3);
  });

  it('allergènes de l\'ordre : soja consommé et signalé comme ajouté', async () => {
    const a = await subs.actualAllergensForPlan(planId);
    expect(a.consumed).toEqual(['soja']);
    expect(a.added_by_substitution).toEqual(['soja']);
  });
});
