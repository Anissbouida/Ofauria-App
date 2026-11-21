/**
 * Scénario 1, constat 107 — saisie de la composition contrôlée.
 *  - « composition vide » = aucune ligne (liste et fiche), y compris pour une préparation
 *    de base ; une ligne d'ingrédient sans prix n'en fait plus une composition vide ;
 *  - une ligne à 0 ou négative est refusée par le serveur (plus écartée en silence).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, cleanupFixtures, RUN, type Fixtures } from './helpers.js';
import { replaceComponentsSchema } from '../../validators/recipe-component.validator.js';

describe.skipIf(!hasTestDb)('Composition de fiche : saisie contrôlée (constat 107)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let recipes: typeof import('../../repositories/recipe.repository.js')['recipeRepository'];
  let fx: Fixtures;
  let baseId = '', formatId = '', ingId = '';
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    recipes = (await import('../../repositories/recipe.repository.js')).recipeRepository;
    fx = await createBaseFixtures();
    baseId = (await p().query(`INSERT INTO recipes (name, is_base) VALUES ($1, true) RETURNING id`, [`Base vide ${RUN}`])).rows[0].id;
    formatId = (await p().query(
      `INSERT INTO recipe_formats (recipe_id, quantite_par_format) VALUES ($1, 1000) RETURNING id`, [baseId])).rows[0].id;
    ingId = await createIngredient(fx, { name: 'Colorant sans prix', unit: 'g', unitCost: 0 });
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM recipe_format_components WHERE format_id = $1`, [formatId]).catch(() => undefined);
    await p().query(`DELETE FROM recipe_formats WHERE id = $1`, [formatId]).catch(() => undefined);
    await p().query(`DELETE FROM recipes WHERE id = $1`, [baseId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('une préparation de base sans ligne est signalée vide, sur la fiche et dans la liste', async () => {
    expect((await recipes.findById(baseId) as { compo_vide: boolean }).compo_vide).toBe(true);
    const row = (await recipes.findAll() as { id: string; compo_vide: boolean }[]).find(r => r.id === baseId);
    expect(row?.compo_vide).toBe(true);
  });

  it('une ligne d\'ingrédient sans prix n\'est pas une composition vide', async () => {
    await p().query(
      `INSERT INTO recipe_format_components (format_id, source_ingredient_id, quantite, unite, ordre) VALUES ($1, $2, 5, 'g', 0)`,
      [formatId, ingId]);
    expect((await recipes.findById(baseId) as { compo_vide: boolean }).compo_vide).toBe(false);
  });

  it('une quantité à 0 ou négative est refusée', () => {
    const line = (quantite: number) => ({ components: [{ sourceIngredientId: ingId, quantite, unite: 'g' }] });
    expect(replaceComponentsSchema.safeParse(line(0)).success).toBe(false);
    expect(replaceComponentsSchema.safeParse(line(-5)).success).toBe(false);
    expect(replaceComponentsSchema.safeParse(line(5)).success).toBe(true);
  });
});
