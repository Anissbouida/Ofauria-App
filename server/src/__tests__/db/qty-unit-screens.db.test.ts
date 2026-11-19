/**
 * M3-04 — écrans basculés sur quantité + unité (mig 557) : fiche technique (poids de pièce,
 * poids cru / cuit du format), rendement (pesées), contenants (poids).
 *  - le nouveau chemin écrit quantité + unité saisie ; l'ancienne colonne suit, convertie ;
 *  - la lecture rend l'unité saisie (420 g reste 420 g) ;
 *  - l'ancien chemin (champ _kg / _g seul) donne les mêmes chiffres qu'avant ;
 *  - les calculs (freinte, prix) restent faits sur la valeur convertie : zéro écart.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Quantité + unité dans les écrans (M3-04)', () => {
  let fx: Fixtures;
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  const ids: Record<string, string> = {};
  const p = () => testPool();
  const f = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  beforeAll(async () => {
    repos = await importRepositories();
    fx = await createBaseFixtures();
  }, 60_000);

  afterAll(async () => {
    const run = async (sql: string, params: unknown[]) => { try { await p().query(sql, params); } catch { /* best effort */ } };
    if (ids.plan) await run(`DELETE FROM production_plans WHERE id = $1`, [ids.plan]);
    if (ids.contenant) await run(`DELETE FROM production_contenants WHERE id = $1`, [ids.contenant]);
    if (ids.recipe) await run(`DELETE FROM recipe_versions WHERE recipe_id = $1`, [ids.recipe]);
    if (ids.recipe) fx.ids.recipes.push(ids.recipe);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  }, 60_000);

  it('contenants : poids saisi en g conservé, poids_kg converti ; ancien chemin identique', async () => {
    const { productionContenantRepository: repo } = await import('../../repositories/production-contenant.repository.js');
    const c = await repo.createContenant({
      nom: `Cadre M304 ${RUN}`, type_production: 1, unite_lancement: 'cadre', quantite_theorique: 20, pertes_fixes: 0,
      poids_qty: 350, poids_unit: 'g', etapes_defaut: [], categories_pertes: [],
    });
    ids.contenant = c.id;
    expect([f(c.poids_qty), c.poids_unit, f(c.poids_kg)]).toEqual([350, 'g', 0.35]);
    const legacy = await repo.updateContenant(c.id, { poids_kg: 2 });
    expect([f(legacy.poids_qty), legacy.poids_unit, f(legacy.poids_kg)]).toEqual([2, 'kg', 2]);
    const kg = await repo.updateContenant(c.id, { poids_qty: 1.5, poids_unit: 'kg' });
    expect([f(kg.poids_qty), kg.poids_unit, f(kg.poids_kg)]).toEqual([1.5, 'kg', 1.5]);
    // Champ non envoyé : poids inchangé.
    const same = await repo.updateContenant(c.id, { nom: `Cadre M304 bis ${RUN}` });
    expect([f(same.poids_qty), same.poids_unit]).toEqual([1.5, 'kg']);
    const cleared = await repo.updateContenant(c.id, { poids_qty: null });
    expect([cleared.poids_qty, cleared.poids_unit, cleared.poids_kg]).toEqual([null, null, null]);
  });

  it('rendement : pesées dans l\'unité saisie, freinte inchangée ; ancien chemin identique', async () => {
    const { productionRendementRepository: repo } = await import('../../repositories/production-rendement.repository.js');
    const def = (await p().query(`SELECT id FROM production_order_types WHERE is_default`)).rows[0].id;
    ids.plan = (await p().query(
      `INSERT INTO production_plans (plan_date, type, created_by, order_type_id, status, store_id)
       VALUES (CURRENT_DATE, 'daily', $1, $2, 'in_progress', $3) RETURNING id`, [fx.userId, def, fx.storeId])).rows[0].id;
    const base = (await p().query(`INSERT INTO recipes (name, yield_quantity, yield_unit, is_base) VALUES ($1, 1, 'kg', true) RETURNING id`, [`Pâte M304 ${RUN}`])).rows[0].id;
    fx.ids.recipes.push(base);
    const item = (await p().query(`INSERT INTO production_plan_items (plan_id, base_recipe_id, planned_quantity) VALUES ($1, $2, 30) RETURNING id`, [ids.plan, base])).rows[0].id;
    const common = { planItemId: item, planId: ids.plan, quantiteBrute: 30, quantiteNetteReelle: 28, versMagasin: 28, versFrigo: 0, pertesDetail: [], recordedBy: fx.userId };

    const r = await repo.record({ ...common,
      massePetrie: { qty: 12500, unit: 'g' }, patonsNombre: 30, patonsPoidsUnitaire: { qty: 0.42, unit: 'kg' }, masseCuite: { qty: 11, unit: 'kg' } });
    expect([f(r.masse_petrie_qty), r.masse_petrie_unit, f(r.masse_petrie_kg)]).toEqual([12500, 'g', 12.5]);
    expect([f(r.patons_poids_unitaire_qty), r.patons_poids_unitaire_unit, f(r.patons_poids_unitaire_g)]).toEqual([0.42, 'kg', 420]);
    expect([f(r.masse_cuite_qty), r.masse_cuite_unit, f(r.masse_cuite_kg)]).toEqual([11, 'kg', 11]);
    expect(f(r.freinte_reelle_pct)).toBe(12);

    // Ancien chemin (champs _kg / _g) : mêmes chiffres qu'avant M3-04.
    const old = await repo.record({ ...common, massePetrieKg: 12.5, patonsNombre: 30, patonsPoidsUnitaireG: 420, masseCuiteKg: 11 });
    expect([f(old.masse_petrie_kg), f(old.patons_poids_unitaire_g), f(old.masse_cuite_kg), f(old.freinte_reelle_pct)]).toEqual([12.5, 420, 11, 12]);
    expect([old.masse_petrie_unit, old.patons_poids_unitaire_unit, old.masse_cuite_unit]).toEqual(['kg', 'g', 'kg']);
    const read = await repo.findByPlanItem(item);
    expect([f(read.patons_poids_unitaire_qty), read.patons_poids_unitaire_unit]).toEqual([420, 'g']);
  });

  it('fiche technique : poids de pièce et poids du format dans l\'unité saisie, versionnés', async () => {
    const { recipeRepository } = await import('../../repositories/recipe.repository.js');
    const { recipeComponentRepository } = await import('../../repositories/recipe-component.repository.js');
    const created = await recipeRepository.create({
      name: `Baguette M304 ${RUN}`, isBase: true, yieldQuantity: 1, yieldUnit: 'kg',
      pieceWeightQty: 420, pieceWeightUnit: 'g', ingredients: [], changedBy: fx.userId,
    });
    ids.recipe = created.id;
    let rec = await recipeRepository.findById(created.id);
    expect([f(rec.piece_weight_qty), rec.piece_weight_unit, f(rec.piece_weight_kg)]).toEqual([420, 'g', 0.42]);

    await recipeRepository.update(created.id, { name: `Baguette M304 ${RUN}`, yieldUnit: 'kg', pieceWeightQty: 0.5, pieceWeightUnit: 'kg', changedBy: fx.userId });
    rec = await recipeRepository.findById(created.id);
    expect([f(rec.piece_weight_qty), rec.piece_weight_unit, f(rec.piece_weight_kg)]).toEqual([0.5, 'kg', 0.5]);
    // La version prise avant la modification garde 420 g.
    const v = (await p().query(
      `SELECT piece_weight_qty::float8 AS q, (SELECT code FROM ref_entries WHERE id = piece_weight_unit_id) AS u, piece_weight_kg::float8 AS kg
         FROM recipe_versions WHERE recipe_id = $1 ORDER BY version_number DESC LIMIT 1`, [created.id])).rows[0];
    expect(v).toEqual({ q: 420, u: 'g', kg: 0.42 });
    // Sans poids envoyé : inchangé.
    await recipeRepository.update(created.id, { name: `Baguette M304 ${RUN}`, yieldUnit: 'kg', changedBy: fx.userId });
    rec = await recipeRepository.findById(created.id);
    expect([f(rec.piece_weight_qty), rec.piece_weight_unit]).toEqual([0.5, 'kg']);

    const fmt = (await p().query(`INSERT INTO recipe_formats (recipe_id, quantite_par_format) VALUES ($1, 500) RETURNING id`, [created.id])).rows[0].id;
    await recipeComponentRepository.replaceForFormat(created.id, fmt, { components: [], poidsCruQty: 0.5, poidsCruUnit: 'kg', poidsCuitQty: 430, poidsCuitUnit: 'g' }, fx.userId);
    const byFormat = await recipeComponentRepository.findByFormat(created.id, fmt) as { format: Record<string, any> } | null;
    const fm = byFormat!.format;
    expect([f(fm.poids_cru_qty), fm.poids_cru_unit, f(fm.poids_cru_g)]).toEqual([0.5, 'kg', 500]);
    expect([f(fm.poids_cuit_qty), fm.poids_cuit_unit, f(fm.poids_cuit_g)]).toEqual([430, 'g', 430]);
    // Ancien chemin (grammes) : identique.
    await recipeComponentRepository.replaceForFormat(created.id, fmt, { components: [], poidsCruG: 520 }, fx.userId);
    const after = (await p().query(`SELECT poids_cru_g::float8 AS g, poids_cru_qty::float8 AS q, poids_cuit_g::float8 AS cuit FROM recipe_formats WHERE id = $1`, [fmt])).rows[0];
    expect(after).toEqual({ g: 520, q: 520, cuit: 430 });
  });
});
