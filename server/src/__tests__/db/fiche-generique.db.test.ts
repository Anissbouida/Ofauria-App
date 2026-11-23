/**
 * Fiche technique générique (plan d'exécution multi-industries, étape 2 bis, mig 634-635).
 *
 *   - ligne d'emballage : coût du format recalculé, ignorée par le miroir (vues de coût),
 *     sortie du stock d'emballages à la déclaration ;
 *   - mode pourcentage : les quantités se déduisent du lot de référence, les besoins
 *     sont identiques à ceux de la même fiche saisie en quantités ;
 *   - DDM : durée longue acceptée, lot daté DDM, pas de péremption automatique ;
 *   - unités du format contrôlées par le référentiel ;
 *   - nutrition : moyenne pondérée sur l'étiquette, exigée pour un article préemballé.
 */
process.env.POS_ALLOW_NEGATIVE_STOCK = 'off';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, createProductWithRecipe, cleanupFixtures,
  num, RUN, type Fixtures,
} from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe.skipIf(!hasTestDb)('Fiche technique générique', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let comps: any; let labels: any; let lots: any;
  let fx: Fixtures;
  const p = () => testPool();
  const packagingIds: string[] = [];

  async function format(recipeId: string, opts: { unit?: string; rendement?: string } = {}) {
    return (await p().query(
      `INSERT INTO recipe_formats (recipe_id, quantite_par_format, quantite_par_format_unite, nb_par_defaut, is_default, is_active, rendement_unite)
       VALUES ($1, 100, $2, 1, true, true, $3) RETURNING id`, [recipeId, opts.unit ?? 'g', opts.rendement ?? 'unit'])).rows[0].id as string;
  }

  beforeAll(async () => {
    repos = await importRepositories();
    comps = (await import('../../repositories/recipe-component.repository.js')).recipeComponentRepository;
    labels = (await import('../../repositories/product-label.repository.js')).productLabelRepository;
    lots = (await import('../../repositories/product-lot.repository.js')).productLotRepository;
    fx = await createBaseFixtures();
  }, 60_000);

  afterAll(async () => {
    const run = async (sql: string, params: unknown[]) => { try { await p().query(sql, params); } catch { /* best effort */ } };
    await run(`DELETE FROM recipe_format_components WHERE format_id IN (SELECT id FROM recipe_formats WHERE recipe_id = ANY($1))`, [fx.ids.recipes]);
    await run(`DELETE FROM recipe_components WHERE recipe_id = ANY($1)`, [fx.ids.recipes]);
    await run(`DELETE FROM recipe_versions WHERE recipe_id = ANY($1)`, [fx.ids.recipes]);
    await run(`DELETE FROM recipe_formats WHERE recipe_id = ANY($1)`, [fx.ids.recipes]);
    await run(`DELETE FROM packaging_stock_transactions WHERE packaging_id = ANY($1)`, [packagingIds]);
    await run(`DELETE FROM packaging_store_stock WHERE packaging_id = ANY($1)`, [packagingIds]);
    if (fx) await cleanupFixtures(fx);
    await run(`DELETE FROM packaging_items WHERE id = ANY($1)`, [packagingIds]);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('ligne d\'emballage : coût du format recalculé, absente du miroir, sortie du stock à la déclaration', async () => {
    const sucre = await createIngredient(fx, { name: 'Sucre fg', unit: 'kg', unitCost: 10 });
    await createLot(fx, { ingredientId: sucre, lotNumber: 'SFG', pesage: 50, expiresInDays: 60, unitCost: 10 });
    const pot = (await p().query(`INSERT INTO packaging_items (name, unit, unit_cost) VALUES ($1, 'unit', 1.5) RETURNING id`, [`Pot verre ${RUN}`])).rows[0].id;
    packagingIds.push(pot);
    await p().query(`INSERT INTO packaging_store_stock (packaging_id, store_id, stock_quantity) VALUES ($1, $2, 100)`, [pot, fx.storeId]);
    const pr = await createProductWithRecipe(fx, { name: 'Confiture fg', price: 20, ingredients: [] });
    const fmt = await format(pr.recipeId);
    await comps.replaceForFormat(pr.recipeId, fmt, { components: [
      { sourceIngredientId: sucre, quantite: 0.25, unite: 'kg', ordre: 0 },
      { sourcePackagingId: pot, quantite: 1, unite: 'unit', ordre: 1 },
    ] });
    const f = (await p().query(`SELECT cout_emballage_unitaire FROM recipe_formats WHERE id = $1`, [fmt])).rows[0];
    expect(num(f.cout_emballage_unitaire)).toBeCloseTo(1.5, 4);
    const roles = (await p().query(`SELECT role FROM recipe_format_components WHERE format_id = $1 ORDER BY ordre`, [fmt])).rows.map(r => r.role);
    expect(roles).toEqual(['matiere', 'emballage']);
    const mirror = (await p().query(`SELECT count(*)::int AS n FROM recipe_components WHERE recipe_id = $1`, [pr.recipeId])).rows[0].n;
    expect(mirror).toBe(1);

    // Plan de 10 sans bon de sortie (matière sortie à la déclaration) : 10 pots sortent.
    const plan = await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId: pr.productId, plannedQuantity: 10 }],
    });
    fx.ids.plans.push(plan.id);
    await repos.productionRepository.confirm(plan.id, fx.userId);
    const bon = (await repos.bonSortieRepository.findByPlan(plan.id))[0];
    await repos.bonSortieRepository.markAsPreparation(bon.id, fx.userId);
    const fresh = (await repos.bonSortieRepository.findByPlan(plan.id))[0];
    await repos.bonSortieRepository.weighLignes(bon.id, fx.userId, (fresh.lines as any[]).filter(l => num(l.allocated_quantity) > 0)
      .map(l => ({ ligneId: l.id, actualQuantity: num(l.allocated_quantity), source: 'manual' })));
    await repos.bonSortieRepository.markAsReady(bon.id, fx.userId);
    await repos.bonSortieRepository.acceptReception(bon.id, fx.userId);
    await repos.productionRepository.start(plan.id, fx.userId);
    const item = (await p().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [plan.id])).rows[0].id;
    await repos.productionRepository.produceItems(plan.id, [{ planItemId: item, actualQuantity: 10 }], fx.userId, fx.storeId);
    const stock = (await p().query(`SELECT stock_quantity FROM packaging_store_stock WHERE packaging_id = $1 AND store_id = $2`, [pot, fx.storeId])).rows[0];
    expect(num(stock.stock_quantity)).toBeCloseTo(90, 3);
  });

  it('mode pourcentage : quantités déduites du lot de référence, besoins identiques au mode quantités', async () => {
    const fraise = await createIngredient(fx, { name: 'Fraise fg', unit: 'kg', unitCost: 8 });
    const sucre2 = await createIngredient(fx, { name: 'Sucre2 fg', unit: 'kg', unitCost: 6 });
    const pr = await createProductWithRecipe(fx, { name: 'Vrac pct fg', price: 5, ingredients: [] });
    await p().query(`UPDATE recipes SET reference_mode = 'pourcentage', reference_batch_qty = 500, reference_batch_unit = 'kg', yield_quantity = 500, yield_unit = 'kg' WHERE id = $1`, [pr.recipeId]);
    const fmt = await format(pr.recipeId);
    await comps.replaceForFormat(pr.recipeId, fmt, { components: [
      { sourceIngredientId: fraise, quantite: 1, unite: 'kg', ordre: 0, pct: 55 },
      { sourceIngredientId: sucre2, quantite: 1, unite: 'kg', ordre: 1, pct: 45 },
    ] });
    const rows = (await p().query(`SELECT quantite::float8 AS q, unite, pct::float8 AS pct FROM recipe_format_components WHERE format_id = $1 ORDER BY ordre`, [fmt])).rows;
    expect(rows).toEqual([{ q: 275, unite: 'kg', pct: 55 }, { q: 225, unite: 'kg', pct: 45 }]);
    expect((await p().query(`SELECT pct::float8 AS pct FROM recipe_components WHERE recipe_id = $1 ORDER BY ordre`, [pr.recipeId])).rows.map(r => r.pct)).toEqual([55, 45]);
  });

  it('DDM : durée longue acceptée, lot daté DDM, pas de péremption automatique', async () => {
    const pr = await createProductWithRecipe(fx, { name: 'Biscuit sec fg', price: 3, ingredients: [] });
    await p().query(`UPDATE products SET date_kind = 'ddm', shelf_life_days = 730, sale_type = 'stock' WHERE id = $1`, [pr.productId]);
    await expect(p().query(`UPDATE products SET shelf_life_days = 4000 WHERE id = $1`, [pr.productId])).rejects.toThrow();
    const lot = (await p().query(
      `INSERT INTO product_lots (product_id, store_id, lot_number, quantity_total, backroom_qty, produced_at, expires_at, status)
       VALUES ($1, $2, $3, 5, 5, NOW() - INTERVAL '800 days', CURRENT_DATE - 30, 'active') RETURNING id, date_kind`, [pr.productId, fx.storeId, `DDM-${RUN}`])).rows[0];
    expect(lot.date_kind).toBe('ddm');
    await lots.autoExpireDueLots();
    expect((await p().query(`SELECT status FROM product_lots WHERE id = $1`, [lot.id])).rows[0].status).toBe('active');
    await expect(p().query(`UPDATE products SET sale_type = 'inconnu' WHERE id = $1`, [pr.productId])).rejects.toThrow(/Cycle de vente inconnu/);
  });

  it('unités du format contrôlées par le référentiel', async () => {
    const pr = await createProductWithRecipe(fx, { name: 'Format unite fg', price: 3, ingredients: [] });
    await expect(format(pr.recipeId, { unit: 'boisseau' })).rejects.toThrow(/Unité inconnue/);
    await expect(format(pr.recipeId, { rendement: 'l' })).resolves.toBeTruthy();
  });

  it('nutrition : moyenne pondérée sur l\'étiquette, exigée pour un article préemballé', async () => {
    const a = await createIngredient(fx, { name: 'Farine nut', unit: 'kg', unitCost: 5 });
    const b = await createIngredient(fx, { name: 'Beurre nut', unit: 'kg', unitCost: 50 });
    await p().query(`UPDATE ingredients SET allergens_reviewed_at = NOW() WHERE id = ANY($1)`, [[a, b]]);
    const pr = await createProductWithRecipe(fx, { name: 'Sablé nut', price: 4, ingredients: [
      { ingredientId: a, quantity: 0.75, unit: 'kg' }, { ingredientId: b, quantity: 0.25, unit: 'kg' },
    ] });
    await p().query(`UPDATE products SET prepackaged = true WHERE id = $1`, [pr.productId]);
    let data = await labels.labelData(pr.productId);
    expect(data.blockers.join(' ')).toMatch(/préemballé/);

    const nut = (kcal: number, fat: number) => JSON.stringify({ energy_kj: kcal * 4.184, energy_kcal: kcal, fat, saturated_fat: fat / 2, carbohydrates: 10, sugars: 1, protein: 5, salt: 0.1 });
    await p().query(`UPDATE ingredients SET nutrition = $2::jsonb WHERE id = $1`, [a, nut(350, 1)]);
    await p().query(`UPDATE ingredients SET nutrition = $2::jsonb WHERE id = $1`, [b, nut(750, 82)]);
    data = await labels.labelData(pr.productId);
    expect(data.nutrition.complete).toBe(true);
    // 0,75 × 350 + 0,25 × 750 = 450 kcal ; 0,75 × 1 + 0,25 × 82 = 21,25 g de matières grasses.
    expect(data.nutrition.per100g.energy_kcal).toBeCloseTo(450, 1);
    expect(data.nutrition.per100g.fat).toBeCloseTo(21.3, 1);
    expect(data.blockers.join(' ')).not.toMatch(/préemballé/);
  });
});
