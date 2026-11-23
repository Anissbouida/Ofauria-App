/**
 * Scénario 1, constat 109 — dupliquer une fiche entière (services/recipe-duplicate.ts).
 *  - la copie reprend paramètres, étapes, formats et composition ;
 *  - elle n'est reliée à aucun produit et prend le nom et la catégorie demandés ;
 *  - elle est indépendante : la modifier ne touche pas l'original.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, createProductWithRecipe, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Dupliquer une fiche entière (constat 109)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let dup: typeof import('../../services/recipe-duplicate.js');
  let fx: Fixtures;
  let sourceId = '', copyId = '', farine = '';
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    dup = await import('../../services/recipe-duplicate.js');
    fx = await createBaseFixtures();
    farine = await createIngredient(fx, { name: 'Farine C109', unit: 'kg', unitCost: 6 });
    const sel = await createIngredient(fx, { name: 'Sel C109', unit: 'kg', unitCost: 2 });
    const made = await createProductWithRecipe(fx, { name: 'Baguette C109', price: 3, shelfLifeDays: null,
      ingredients: [] }); // composition posée ci-dessous dans le format par défaut (pas 2b-1)
    sourceId = made.recipeId;
    await p().query(`UPDATE recipes SET etapes = $2, margin_multiplier = 2.4, main_oeuvre_min = 45 WHERE id = $1`,
      [sourceId, JSON.stringify([{ nom: 'Pétrissage', duree_min: 15 }])]);
    const fid = (await p().query(
      `INSERT INTO recipe_formats (recipe_id, quantite_par_format, nb_par_defaut, is_default) VALUES ($1, 1000, 40, true) RETURNING id`, [sourceId])).rows[0].id;
    await p().query(
      `INSERT INTO recipe_format_components (format_id, source_ingredient_id, quantite, unite, ordre, perte_pct)
       VALUES ($1, $2, 10, 'kg', 0, 2), ($1, $3, 200, 'g', 1, 0)`, [fid, farine, sel]);
  }, 60_000);

  afterAll(async () => {
    const ids = [copyId].filter(Boolean);
    await p().query(`DELETE FROM recipe_format_components WHERE format_id IN (SELECT id FROM recipe_formats WHERE recipe_id = ANY($1::uuid[]))`, [ids]).catch(() => undefined);
    await p().query(`DELETE FROM recipe_formats WHERE recipe_id = ANY($1::uuid[])`, [ids]).catch(() => undefined);
    await p().query(`DELETE FROM recipes WHERE id = ANY($1::uuid[])`, [ids]).catch(() => undefined);
    await p().query(`DELETE FROM recipe_format_components WHERE format_id IN (SELECT id FROM recipe_formats WHERE recipe_id = $1)`, [sourceId]).catch(() => undefined);
    await p().query(`DELETE FROM recipe_formats WHERE recipe_id = $1`, [sourceId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('la copie reprend paramètres, étapes, formats et composition, sans produit', async () => {
    copyId = await dup.duplicateRecipe(sourceId, `Pain complet C109 ${RUN}`, null, fx.userId);
    const r = (await p().query(`SELECT name, product_id, category_id, margin_multiplier, main_oeuvre_min, etapes FROM recipes WHERE id = $1`, [copyId])).rows[0];
    expect(r.name).toBe(`Pain complet C109 ${RUN}`);
    expect(r.product_id).toBeNull();
    expect(r.category_id).toBeNull();
    expect(Number(r.margin_multiplier)).toBeCloseTo(2.4, 3);
    expect(r.main_oeuvre_min).toBe(45);
    expect(r.etapes).toEqual([{ nom: 'Pétrissage', duree_min: 15 }]);
    const lines = (await p().query(
      `SELECT c.source_ingredient_id, c.quantite::float AS q, c.unite, c.perte_pct::float AS perte, f.nb_par_defaut
         FROM recipe_format_components c JOIN recipe_formats f ON f.id = c.format_id WHERE f.recipe_id = $1 ORDER BY c.ordre`, [copyId])).rows;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ source_ingredient_id: farine, q: 10, unite: 'kg', perte: 2, nb_par_defaut: 40 });
  });

  it('la copie est indépendante de l\'original', async () => {
    await p().query(
      `UPDATE recipe_format_components SET quantite = 12 WHERE source_ingredient_id = $1
          AND format_id IN (SELECT id FROM recipe_formats WHERE recipe_id = $2)`, [farine, copyId]);
    const orig = (await p().query(
      `SELECT c.quantite::float AS q FROM recipe_format_components c JOIN recipe_formats f ON f.id = c.format_id
        WHERE f.recipe_id = $1 AND c.source_ingredient_id = $2`, [sourceId, farine])).rows[0].q;
    expect(orig).toBe(10);
  });

  it('nom vide ou fiche inconnue : refus explicite', async () => {
    await expect(dup.duplicateRecipe(sourceId, '  ', null, fx.userId)).rejects.toMatchObject({ statusCode: 400 });
    await expect(dup.duplicateRecipe('00000000-0000-0000-0000-000000000000', 'X', null, fx.userId)).rejects.toMatchObject({ statusCode: 404 });
  });
});
