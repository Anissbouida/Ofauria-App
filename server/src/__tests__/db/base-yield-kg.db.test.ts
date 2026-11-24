/**
 * Scénario 1 (atelier viennoiserie) — une préparation de base au kilo (mig 613) se coûte
 * sur son vrai rendement quand une autre fiche l'emploie.
 *  - l'enregistrement de son format par défaut au kilo recopie le rendement kilo dans
 *    recipes.yield_quantity (lu par listSources et v_recipe_component_cost) ;
 *  - 60 g de pâte = 60 g × (coût de la fournée ÷ rendement), pas 6 % de la fournée.
 *  - une base en pièces garde son rendement recette.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Rendement kilo d\'une préparation de base', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let recipeComponentRepository: typeof import('../../repositories/recipe-component.repository.js')['recipeComponentRepository'];
  let fx: Fixtures;
  let farine: string, baseId: string, baseFormatId: string;
  const p = () => testPool();

  const newBase = async (name: string) => {
    const r = await p().query(
      `INSERT INTO recipes (name, is_base, yield_quantity, yield_unit, mode_cout)
       VALUES ($1, true, 1, 'kg', 'compose') RETURNING id`, [`${name} ${RUN}`]);
    fx.ids.recipes.push(r.rows[0].id);
    const f = await p().query(
      `INSERT INTO recipe_formats (recipe_id, quantite_par_format, nb_par_defaut, is_active, is_default)
       VALUES ($1, 1, 10, true, true) RETURNING id`, [r.rows[0].id]);
    return { id: r.rows[0].id as string, formatId: f.rows[0].id as string };
  };

  beforeAll(async () => {
    repos = await importRepositories();
    ({ recipeComponentRepository } = await import('../../repositories/recipe-component.repository.js'));
    fx = await createBaseFixtures();
    farine = await createIngredient(fx, { name: 'Farine base kg', unit: 'kg', unitCost: 10 });
    ({ id: baseId, formatId: baseFormatId } = await newBase('Pâte base kg'));
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('le rendement kilo du format par défaut devient le rendement de la base', async () => {
    // 10 kg de farine à 10 DH = 100 DH la fournée, 8 kg utilisables.
    await recipeComponentRepository.replaceForFormat(baseId, baseFormatId, {
      components: [{ sourceIngredientId: farine, quantite: 10, unite: 'kg', ordre: 0 }],
      rendementUnite: 'kg', rendementKg: 8,
    } as never);
    const r = (await p().query(`SELECT yield_quantity, yield_unit FROM recipes WHERE id = $1`, [baseId])).rows[0];
    expect(Number(r.yield_quantity)).toBe(8);
    expect(r.yield_unit).toBe('kg');

    const src = (await recipeComponentRepository.listSources()).recipes.find((s: { id: string }) => s.id === baseId);
    expect(Number(src.cout_unitaire)).toBeCloseTo(12.5, 4);
  });

  it('60 g de la base dans une autre fiche coûtent 60 g au coût du kilo', async () => {
    const prod = await p().query(
      `INSERT INTO recipes (name, yield_quantity, yield_unit, mode_cout, compo_par_piece)
       VALUES ($1, 1, 'unit', 'compose', true) RETURNING id`, [`Croissant base kg ${RUN}`]);
    fx.ids.recipes.push(prod.rows[0].id);
    const f = await p().query(
      `INSERT INTO recipe_formats (recipe_id, quantite_par_format, nb_par_defaut, is_active, is_default)
       VALUES ($1, 1, 40, true, true) RETURNING id`, [prod.rows[0].id]);
    await recipeComponentRepository.replaceForFormat(prod.rows[0].id, f.rows[0].id, {
      components: [{ sourceRecipeId: baseId, quantite: 60, unite: 'g', ordre: 0 }],
    } as never);
    const c = (await p().query(
      `SELECT cout_dh FROM v_recipe_component_cost_v2 WHERE format_id = $1`, [f.rows[0].id])).rows[0];
    expect(Number(c.cout_dh)).toBeCloseTo(0.06 * 12.5, 4);
  });

  it('les besoins d\'une quantité en kilos se divisent par le rendement kilo, pas par nb_par_defaut', async () => {
    // Format au kilo : fournée de 10 kg de farine qui rend 8 kg ; nb_par_defaut reste à 10
    // (valeur sans objet, comme « Bassine 5 kg » qui rend 2,9 kg). 16 kg = 2 fournées.
    const { collectIngredientNeedsForUnits } = await import('../../repositories/recipe-composition.helper.js');
    for (const formatId of [null, baseFormatId]) {
      const needs = new Map<string, number>();
      await collectIngredientNeedsForUnits(repos.db as never, baseId, 16,
        (id, q) => needs.set(id, (needs.get(id) ?? 0) + q), { formatId });
      expect(needs.get(farine)).toBeCloseTo(20, 4);
    }
  });

  it('une base en pièces garde son rendement recette', async () => {
    const { id, formatId } = await newBase('Base pièces');
    await p().query(`UPDATE recipes SET yield_quantity = 5 WHERE id = $1`, [id]);
    await recipeComponentRepository.replaceForFormat(id, formatId, {
      components: [{ sourceIngredientId: farine, quantite: 5, unite: 'kg', ordre: 0 }],
      nbParDefaut: 12,
    } as never);
    const r = (await p().query(`SELECT yield_quantity FROM recipes WHERE id = $1`, [id])).rows[0];
    expect(Number(r.yield_quantity)).toBe(5);
  });
});
