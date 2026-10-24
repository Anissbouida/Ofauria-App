/**
 * Vues et fonctions SQL de cout — tests sur base migree (TEST_DATABASE_URL).
 *
 * Ce que les tests unitaires TS ne pouvaient pas couvrir (audit 2026-10-23 §6) :
 *   - fn_unit_conv 2 et 3 arguments, fn_unit_conv_ok ;
 *   - v_recipe_component_cost avec densite (mig 340) et son drapeau conversion_ok
 *     qui doit maintenant etre COHERENT avec le cout ;
 *   - v_recipe_allergens / v_product_allergens (mig 343) sur le vrai schema.
 *
 * Chaque test tourne dans une transaction ROLLBACK : aucune trace en base.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { hasTestDb, testPool, closeTestPool, RUN, num } from './helpers.js';

describe.skipIf(!hasTestDb)('SQL — conversions d\'unites', () => {
  afterAll(closeTestPool);

  const conv = async (sql: string) => num((await testPool().query(`SELECT ${sql} AS v`)).rows[0].v);

  it('meme famille : masse et volume', async () => {
    expect(await conv(`fn_unit_conv('kg','g')`)).toBeCloseTo(1000, 6);
    expect(await conv(`fn_unit_conv('g','kg')`)).toBeCloseTo(0.001, 6);
    expect(await conv(`fn_unit_conv('l','ml')`)).toBeCloseTo(1000, 6);
    expect(await conv(`fn_unit_conv('cl','l')`)).toBeCloseTo(0.01, 6);
  });

  it('poids <-> volume sans densite : repli 1, et fn_unit_conv_ok le dit', async () => {
    expect(await conv(`fn_unit_conv('g','l')`)).toBe(1);
    expect(await conv(`fn_unit_conv('g','l', NULL)`)).toBe(1);
    const ok = await testPool().query(`SELECT fn_unit_conv_ok('g','l') AS cross_bad, fn_unit_conv_ok('g','kg') AS same_ok`);
    expect(ok.rows[0].cross_bad).toBe(false);
    expect(ok.rows[0].same_ok).toBe(true);
  });

  it('poids <-> volume avec densite (mig 227)', async () => {
    // 1 kg de lait (1.03 kg/l) = 0.9709 l ; 1 l = 1.03 kg ; 1 g d'huile (0.92) = 1.087 ml
    expect(await conv(`fn_unit_conv('kg','l', 1.03)`)).toBeCloseTo(1 / 1.03, 6);
    expect(await conv(`fn_unit_conv('l','kg', 1.03)`)).toBeCloseTo(1.03, 6);
    expect(await conv(`fn_unit_conv('g','ml', 0.92)`)).toBeCloseTo(1 / 0.92, 6);
    expect(await conv(`fn_unit_conv('g','l', 0.92)`)).toBeCloseTo(1 / 0.92 / 1000, 9);
  });
});

describe.skipIf(!hasTestDb)('SQL — v_recipe_component_cost et densite (mig 340)', () => {
  let client: pg.PoolClient;
  let recipeId: string; let formatId: string; let ingredientId: string;

  beforeAll(async () => {
    client = await testPool().connect();
    await client.query('BEGIN');
    // Huile : stockee en LITRES a 17 DH/l, densite 0.92. Pesee 120 g dans un format.
    const ing = await client.query(
      `INSERT INTO ingredients (name, unit, unit_cost, densite_kg_l, category) VALUES ($1, 'l', 17, 0.92, 'autre') RETURNING id`,
      [`Huile test ${RUN}`]
    );
    ingredientId = ing.rows[0].id;
    const rec = await client.query(
      `INSERT INTO recipes (name, yield_quantity, yield_unit, mode_cout, is_base) VALUES ($1, 1, 'unit', 'compose', false) RETURNING id`,
      [`Beignet test ${RUN}`]
    );
    recipeId = rec.rows[0].id;
    const fmt = await client.query(
      `INSERT INTO recipe_formats (recipe_id, quantite_par_format, quantite_par_format_unite, nb_par_defaut, is_default, is_active)
       VALUES ($1, 1000, 'g', 1, true, true) RETURNING id`,
      [recipeId]
    );
    formatId = fmt.rows[0].id;
    await client.query(
      `INSERT INTO recipe_format_components (format_id, source_ingredient_id, quantite, unite, role) VALUES ($1, $2, 120, 'g', 'ingredient')`,
      [formatId, ingredientId]
    );
  });
  afterAll(async () => { await client.query('ROLLBACK'); client.release(); await closeTestPool(); });

  it('avec densite : 120 g d\'huile a 17 DH/l coutent ~2,22 DH et conversion_ok = true', async () => {
    const r = await client.query(`SELECT cout_dh, conversion_ok FROM v_recipe_component_cost WHERE format_id = $1`, [formatId]);
    expect(r.rows).toHaveLength(1);
    expect(num(r.rows[0].cout_dh)).toBeCloseTo(120 / 0.92 / 1000 * 17, 3); // 2.217
    expect(r.rows[0].conversion_ok).toBe(true);
    const c = await client.query(`SELECT cout_compose_dh, bad_conversions_count FROM v_recipe_compose_cost WHERE format_id = $1`, [formatId]);
    expect(num(c.rows[0].cout_compose_dh)).toBeCloseTo(2.217, 2);
    expect(Number(c.rows[0].bad_conversions_count)).toBe(0);
  });

  it('sans densite : repli facteur 1 (2 040 DH) MAIS conversion_ok = false et bad_conversions_count = 1', async () => {
    await client.query(`UPDATE ingredients SET densite_kg_l = NULL WHERE id = $1`, [ingredientId]);
    const r = await client.query(`SELECT cout_dh, conversion_ok FROM v_recipe_component_cost WHERE format_id = $1`, [formatId]);
    expect(num(r.rows[0].cout_dh)).toBeCloseTo(120 * 17, 3); // le bug historique, desormais SIGNALE
    expect(r.rows[0].conversion_ok).toBe(false);
    const c = await client.query(`SELECT bad_conversions_count FROM v_recipe_compose_cost WHERE format_id = $1`, [formatId]);
    expect(Number(c.rows[0].bad_conversions_count)).toBe(1);
  });

  it('perte_pct de la ligne majore le cout (mig 265 conservee)', async () => {
    await client.query(`UPDATE ingredients SET densite_kg_l = 0.92 WHERE id = $1`, [ingredientId]);
    await client.query(`UPDATE recipe_format_components SET perte_pct = 20 WHERE format_id = $1`, [formatId]);
    const r = await client.query(`SELECT cout_dh FROM v_recipe_component_cost WHERE format_id = $1`, [formatId]);
    expect(num(r.rows[0].cout_dh)).toBeCloseTo(120 / 0.92 / 1000 * 17 / 0.8, 3);
  });
});

describe.skipIf(!hasTestDb)('SQL — allergenes agreges (mig 343)', () => {
  let client: pg.PoolClient;
  let parentId: string; let productId: string;

  beforeAll(async () => {
    client = await testPool().connect();
    await client.query('BEGIN');
    const farine = await client.query(`INSERT INTO ingredients (name, unit, unit_cost, allergens, category) VALUES ($1,'kg',10,ARRAY['gluten'],'autre') RETURNING id`, [`Farine A ${RUN}`]);
    const lait = await client.query(`INSERT INTO ingredients (name, unit, unit_cost, allergens, category) VALUES ($1,'l',8,ARRAY['lait'],'autre') RETURNING id`, [`Lait A ${RUN}`]);
    const noisette = await client.query(`INSERT INTO ingredients (name, unit, unit_cost, allergens, category) VALUES ($1,'kg',90,ARRAY['fruits_a_coque'],'autre') RETURNING id`, [`Noisette A ${RUN}`]);
    // Creme (base, compose) <- lait ; Entremets (produit) <- creme (composant recette) + farine (legacy) ; format inactif avec noisette
    const creme = await client.query(`INSERT INTO recipes (name, yield_quantity, yield_unit, mode_cout, is_base) VALUES ($1,1,'kg','compose',true) RETURNING id`, [`Creme A ${RUN}`]);
    await client.query(`INSERT INTO recipe_components (recipe_id, source_ingredient_id, quantite, unite, role) VALUES ($1,$2,500,'ml','ingredient')`, [creme.rows[0].id, lait.rows[0].id]);
    const prod = await client.query(`INSERT INTO products (name, slug, price) VALUES ($1,$2,45) RETURNING id`, [`Entremets A ${RUN}`, `entremets-a-${RUN}`]);
    productId = prod.rows[0].id;
    const parent = await client.query(`INSERT INTO recipes (product_id, name, yield_quantity, yield_unit, mode_cout) VALUES ($1,$2,1,'unit','compose') RETURNING id`, [productId, `Entremets A ${RUN}`]);
    parentId = parent.rows[0].id;
    await client.query(`INSERT INTO recipe_components (recipe_id, source_recipe_id, quantite, unite, role) VALUES ($1,$2,300,'g','base')`, [parentId, creme.rows[0].id]);
    await client.query(`INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ($1,$2,0.2,'kg')`, [parentId, farine.rows[0].id]);
    const fmtInactif = await client.query(`INSERT INTO recipe_formats (recipe_id, quantite_par_format, nb_par_defaut, is_active, is_default) VALUES ($1,800,1,false,false) RETURNING id`, [parentId]);
    await client.query(`INSERT INTO recipe_format_components (format_id, source_ingredient_id, quantite, unite, role) VALUES ($1,$2,50,'g','ingredient')`, [fmtInactif.rows[0].id, noisette.rows[0].id]);
  });
  afterAll(async () => { await client.query('ROLLBACK'); client.release(); await closeTestPool(); });

  it('remonte les allergenes a travers la nomenclature, ignore les formats inactifs', async () => {
    const r = await client.query(`SELECT allergens, nb_allergens FROM v_recipe_allergens WHERE recipe_id = $1`, [parentId]);
    expect(r.rows[0].allergens).toEqual(['gluten', 'lait']);
    expect(Number(r.rows[0].nb_allergens)).toBe(2);
  });

  it('un format ACTIF declare ses allergenes propres', async () => {
    await client.query(`UPDATE recipe_formats SET is_active = true WHERE recipe_id = $1`, [parentId]);
    const r = await client.query(`SELECT allergens FROM v_recipe_allergens WHERE recipe_id = $1`, [parentId]);
    expect(r.rows[0].allergens).toEqual(['fruits_a_coque', 'gluten', 'lait']);
  });

  it('v_product_allergens projette sur le produit vendu', async () => {
    const r = await client.query(`SELECT allergens FROM v_product_allergens WHERE product_id = $1`, [productId]);
    expect(r.rows[0].allergens).toContain('gluten');
    expect(r.rows[0].allergens).toContain('lait');
  });
});
