/**
 * Scénario 1, constat 108 — coût de revient incomplet signalé (mig 621, v_recipe_cost_gaps).
 *  - ingrédient sans prix, conversion douteuse (litres d'un ingrédient au kilo sans densité),
 *    préparation de base vide ;
 *  - le trou d'une préparation de base remonte à la fiche qui l'utilise (via) ;
 *  - la liste porte cout_incomplet, la fiche le détail (cost_gaps) ;
 *  - un prix renseigné efface le trou.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Coût de revient incomplet (constat 108)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let recipes: typeof import('../../repositories/recipe.repository.js')['recipeRepository'];
  let fx: Fixtures;
  const recipeIds: string[] = [];
  let baseId = '', productId = '', emptyBaseId = '', colorant = '', miel = '';
  const p = () => testPool();

  const recipe = async (name: string, isBase: boolean) => {
    // Une préparation de base se compte au kilo (comme sur les vraies fiches) : unité compatible avec g.
    const id = (await p().query(`INSERT INTO recipes (name, is_base, yield_unit) VALUES ($1, $2, $3) RETURNING id`, [`${name} ${RUN}`, isBase, isBase ? 'kg' : 'unit'])).rows[0].id;
    recipeIds.push(id);
    const formatId = (await p().query(`INSERT INTO recipe_formats (recipe_id, quantite_par_format) VALUES ($1, 1000) RETURNING id`, [id])).rows[0].id;
    return { id, formatId };
  };
  const line = (formatId: string, src: { ing?: string; rec?: string }, quantite: number, unite: string) => p().query(
    `INSERT INTO recipe_format_components (format_id, source_ingredient_id, source_recipe_id, quantite, unite, ordre) VALUES ($1, $2, $3, $4, $5, 0)`,
    [formatId, src.ing ?? null, src.rec ?? null, quantite, unite]);

  beforeAll(async () => {
    repos = await importRepositories();
    recipes = (await import('../../repositories/recipe.repository.js')).recipeRepository;
    fx = await createBaseFixtures();
    colorant = await createIngredient(fx, { name: 'Colorant C108', unit: 'g', unitCost: 0 });
    miel = await createIngredient(fx, { name: 'Miel C108', unit: 'kg', unitCost: 90 });
    const sucre = await createIngredient(fx, { name: 'Sucre C108', unit: 'kg', unitCost: 8 });

    const base = await recipe('Glaçage C108', true);
    baseId = base.id;
    await line(base.formatId, { ing: sucre }, 500, 'g');
    await line(base.formatId, { ing: colorant }, 2, 'g');

    const empty = await recipe('Base vide C108', true);
    emptyBaseId = empty.id;

    const prod = await recipe('Gâteau C108', false);
    productId = prod.id;
    await line(prod.formatId, { rec: baseId }, 100, 'g');
    await line(prod.formatId, { ing: miel }, 0.1, 'l');
    await line(prod.formatId, { rec: emptyBaseId }, 50, 'g');
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM recipe_format_components WHERE format_id IN (SELECT id FROM recipe_formats WHERE recipe_id = ANY($1::uuid[]))`, [recipeIds]).catch(() => undefined);
    await p().query(`DELETE FROM recipe_formats WHERE recipe_id = ANY($1::uuid[])`, [recipeIds]).catch(() => undefined);
    await p().query(`DELETE FROM recipes WHERE id = ANY($1::uuid[])`, [recipeIds]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  const gaps = async (id: string) => (await p().query(
    `SELECT composant, motif, via FROM v_recipe_cost_gaps WHERE recipe_id = $1 ORDER BY motif, composant`, [id])).rows;

  it('la base signale son ingrédient sans prix', async () => {
    expect(await gaps(baseId)).toEqual([{ composant: `Colorant C108 ${RUN}`, motif: 'sans_prix', via: null }]);
  });

  it('la fiche produit : conversion douteuse, préparation vide, et le trou de la base (via)', async () => {
    expect(await gaps(productId)).toEqual([
      { composant: `Miel C108 ${RUN}`, motif: 'conversion', via: null },
      { composant: `Base vide C108 ${RUN}`, motif: 'preparation_vide', via: null },
      { composant: `Colorant C108 ${RUN}`, motif: 'sans_prix', via: `Glaçage C108 ${RUN}` },
    ]);
    const row = (await recipes.findAll() as { id: string; cout_incomplet: boolean }[]).find(r => r.id === productId);
    expect(row?.cout_incomplet).toBe(true);
    const detail = await recipes.findById(productId) as { cost_gaps: unknown[] };
    expect(detail.cost_gaps).toHaveLength(3);
  });

  it('un prix et une densité renseignés effacent les trous correspondants', async () => {
    await p().query(`UPDATE ingredients SET unit_cost = 0.5 WHERE id = $1`, [colorant]);
    await p().query(`UPDATE ingredients SET densite_kg_l = 1.4 WHERE id = $1`, [miel]);
    expect(await gaps(baseId)).toEqual([]);
    expect((await gaps(productId)).map(g => g.motif)).toEqual(['preparation_vide']);
  });
});
