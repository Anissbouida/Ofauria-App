/**
 * Scénario 1, constat 114 — deux sessions sur la même composition ne s'écrasent plus en silence.
 *  - findByFormat renvoie un jeton de version ;
 *  - un enregistrement qui porte la version chargée passe et change le jeton ;
 *  - un enregistrement qui porte une version périmée est refusé (STALE_FORMAT) sans rien écrire ;
 *  - sans jeton (anciens appels), le comportement est inchangé.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Composition : écrasement concurrent détecté (constat 114)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let comp: typeof import('../../repositories/recipe-component.repository.js')['recipeComponentRepository'];
  let fx: Fixtures;
  let recipeId = '', formatId = '', eau = '', beurre = '';
  const p = () => testPool();
  const line = (ingId: string, q: number) => ({ sourceIngredientId: ingId, quantite: q, unite: 'kg', ordre: 0 });

  beforeAll(async () => {
    repos = await importRepositories();
    comp = (await import('../../repositories/recipe-component.repository.js')).recipeComponentRepository;
    fx = await createBaseFixtures();
    eau = await createIngredient(fx, { name: 'Eau C114', unit: 'kg', unitCost: 0.01 });
    beurre = await createIngredient(fx, { name: 'Beurre C114', unit: 'kg', unitCost: 85 });
    recipeId = (await p().query(`INSERT INTO recipes (name) VALUES ($1) RETURNING id`, [`Pain de mie C114 ${RUN}`])).rows[0].id;
    formatId = (await p().query(
      `INSERT INTO recipe_formats (recipe_id, quantite_par_format, nb_par_defaut, is_default) VALUES ($1, 1000, 40, true) RETURNING id`, [recipeId])).rows[0].id;
    await comp.replaceForFormat(recipeId, formatId, { components: [line(eau, 6.5), line(beurre, 1)] } as never, fx.userId);
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM recipe_format_components WHERE format_id = $1`, [formatId]).catch(() => undefined);
    await p().query(`DELETE FROM recipe_versions WHERE recipe_id = $1`, [recipeId]).catch(() => undefined);
    await p().query(`DELETE FROM recipe_formats WHERE id = $1`, [formatId]).catch(() => undefined);
    await p().query(`DELETE FROM recipes WHERE id = $1`, [recipeId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  const qty = async (ingId: string) => Number((await p().query(
    `SELECT quantite FROM recipe_format_components WHERE format_id = $1 AND source_ingredient_id = $2`, [formatId, ingId])).rows[0]?.quantite);

  it('la session B, partie d\'une version périmée, est refusée ; la modification de A reste', async () => {
    const loaded = (await comp.findByFormat(recipeId, formatId) as { format: { version: string } }).format.version;
    expect(loaded).toMatch(/^\d+$/);
    // Session A enregistre (eau 4,5) avec la version chargée : accepté.
    const afterA = await comp.replaceForFormat(recipeId, formatId,
      { expectedVersion: loaded, components: [line(eau, 4.5), line(beurre, 1)] } as never, fx.userId) as { format: { version: string } };
    expect(afterA.format.version).not.toBe(loaded);
    // Session B enregistre (beurre 1,2) avec la même version chargée, désormais périmée.
    await expect(comp.replaceForFormat(recipeId, formatId,
      { expectedVersion: loaded, components: [line(eau, 6.5), line(beurre, 1.2)] } as never, fx.userId))
      .rejects.toMatchObject({ code: 'STALE_FORMAT' });
    expect(await qty(eau)).toBe(4.5);
    expect(await qty(beurre)).toBe(1);
  });

  it('sans jeton, l\'enregistrement passe comme avant', async () => {
    await comp.replaceForFormat(recipeId, formatId, { components: [line(eau, 4.5), line(beurre, 1.2)] } as never, fx.userId);
    expect(await qty(beurre)).toBe(1.2);
  });
});
