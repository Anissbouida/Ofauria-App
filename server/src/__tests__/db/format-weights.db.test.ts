/**
 * G2-05 — poids cru et poids cuit des formats, en grille.
 *  - un format actif sans poids apparaît dans la grille, perte non calculable ;
 *  - une pesée réelle récente (pâtons de 80 g, 6,5 kg cuits pour 100 pièces) donne la
 *    proposition : 80 g cru, 65 g cuit ;
 *  - enregistrer 80 / 65 g calcule la perte : 18,8 % ;
 *  - refus : poids nul, poids cuit supérieur au poids cru, format inconnu ;
 *  - null efface une valeur.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createProductWithRecipe, cleanupFixtures, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Poids cru et cuit des formats (G2-05)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let weights: typeof import('../../repositories/format-weights.repository.js')['formatWeightsRepository'];
  let fx: Fixtures;
  let formatId: string, planId: string;
  const p = () => testPool();
  const row = async () => (await weights.list()).find(x => x.formatId === formatId)!;

  beforeAll(async () => {
    repos = await importRepositories();
    ({ formatWeightsRepository: weights } = await import('../../repositories/format-weights.repository.js'));
    fx = await createBaseFixtures();
    const { productId, recipeId } = await createProductWithRecipe(fx, { name: 'Pain G205', price: 3, ingredients: [] });
    formatId = (await p().query(
      `INSERT INTO recipe_formats (recipe_id, quantite_par_format, is_active, is_default) VALUES ($1, 80, true, true) RETURNING id`, [recipeId])).rows[0].id;
    planId = (await p().query(
      `INSERT INTO production_plans (plan_date, type, status, created_by, store_id) VALUES (CURRENT_DATE, 'daily', 'completed', $1, $2) RETURNING id`,
      [fx.userId, fx.storeId])).rows[0].id;
    fx.ids.plans.push(planId);
    const itemId = (await p().query(
      `INSERT INTO production_plan_items (plan_id, product_id, planned_quantity) VALUES ($1, $2, 100) RETURNING id`, [planId, productId])).rows[0].id;
    await p().query(
      `INSERT INTO production_rendement (plan_item_id, plan_id, quantite_brute, quantite_nette_reelle, patons_nombre, patons_poids_unitaire_g, masse_cuite_kg, recorded_by)
       VALUES ($1, $2, 100, 100, 100, 80, 6.5, $3)`, [itemId, planId, fx.userId]);
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM production_rendement WHERE plan_id = $1`, [planId]).catch(() => undefined);
    await p().query(`DELETE FROM production_plan_items WHERE plan_id = $1`, [planId]).catch(() => undefined);
    await p().query(`DELETE FROM recipe_formats WHERE id = $1`, [formatId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('format sans poids : dans la grille, avec la proposition tirée de la pesée réelle', async () => {
    expect(await row()).toMatchObject({
      poidsCruG: null, poidsCuitG: null, pertePct: null, isDefault: true,
      proposal: { cruG: 80, cuitG: 65, samples: 1 },
    });
  });

  it('refus : poids nul, poids cuit supérieur au poids cru, format inconnu', async () => {
    expect(await weights.save(formatId, { poidsCruG: 0, poidsCuitG: 65 }, fx.userId)).toEqual({ error: 'Poids cru : une valeur supérieure à 0 est attendue' });
    expect(await weights.save(formatId, { poidsCruG: 80, poidsCuitG: 90 }, fx.userId)).toEqual({ error: 'Le poids cuit ne peut pas dépasser le poids cru' });
    expect(await weights.save('00000000-0000-0000-0000-000000000000', { poidsCruG: 80, poidsCuitG: 65 }, fx.userId)).toEqual({ error: 'Format introuvable' });
    expect((await row()).poidsCuitG).toBeNull();
  });

  it('enregistrement : la perte à la cuisson est calculée ; null efface', async () => {
    expect(await weights.save(formatId, { poidsCruG: 80, poidsCuitG: 65 }, fx.userId)).toMatchObject({ poidsCruG: 80, poidsCuitG: 65, pertePct: 18.8 });
    const db = (await p().query(`SELECT poids_cru_g::float AS cru, poids_cuit_g::float AS cuit, updated_by FROM recipe_formats WHERE id = $1`, [formatId])).rows[0];
    expect(db).toEqual({ cru: 80, cuit: 65, updated_by: fx.userId });
    expect(await weights.save(formatId, { poidsCruG: 80, poidsCuitG: null }, fx.userId)).toMatchObject({ poidsCruG: 80, poidsCuitG: null, pertePct: null });
  });
});
