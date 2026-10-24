/**
 * Restauration d'une version de recette (mig 346), sur base migree.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, cleanupFixtures, num, type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Recettes — restauration d\'une version', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let restoreRecipeVersion: typeof import('../../repositories/recipe-restore.helper.js')['restoreRecipeVersion'];
  let snapshotRecipeVersion: typeof import('../../repositories/recipe-version.helper.js')['snapshotRecipeVersion'];
  let fx: Fixtures;
  let baseId: string; let farineId: string; let sucreId: string; let formatId: string;

  beforeAll(async () => {
    repos = await importRepositories();
    ({ restoreRecipeVersion } = await import('../../repositories/recipe-restore.helper.js'));
    ({ snapshotRecipeVersion } = await import('../../repositories/recipe-version.helper.js'));
    fx = await createBaseFixtures();
    farineId = await createIngredient(fx, { name: 'Farine R', unit: 'kg', unitCost: 10 });
    sucreId = await createIngredient(fx, { name: 'Sucre R', unit: 'kg', unitCost: 12 });
    const base = await testPool().query(
      `INSERT INTO recipes (name, yield_quantity, yield_unit, mode_cout, is_base, etapes, margin_multiplier, hydratation_pct)
       VALUES ($1, 1, 'kg', 'compose', true, $2, 3, 65) RETURNING id`,
      [`Pate R ${Date.now()}`, JSON.stringify([{ ordre: 1, nom: 'Petrissage', type: 'petrissage', duree_estimee_min: 12 }])]
    );
    baseId = base.rows[0].id; fx.ids.recipes.push(baseId);
    await testPool().query(`INSERT INTO recipe_components (recipe_id, source_ingredient_id, quantite, unite, role) VALUES ($1, $2, 600, 'g', 'ingredient')`, [baseId, farineId]);
    const fmt = await testPool().query(`INSERT INTO recipe_formats (recipe_id, quantite_par_format, nb_par_defaut, is_default, is_active) VALUES ($1, 1000, 1, true, true) RETURNING id`, [baseId]);
    formatId = fmt.rows[0].id;
    await testPool().query(`INSERT INTO recipe_format_components (format_id, source_ingredient_id, quantite, unite, role) VALUES ($1, $2, 600, 'g', 'ingredient')`, [formatId, farineId]);
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('restaure la nomenclature, les etapes et les frais, apres avoir verse l\'etat courant', async () => {
    // v1 = etat initial (600 g farine, marge x3, hydratation 65, 1 etape)
    expect(await snapshotRecipeVersion(repos.db, baseId, fx.userId, 'etat initial')).toBe(1);

    // Modifications : composant sucre ajoute, marge x4, hydratation 70, etape supprimee, format en 1200 g.
    await testPool().query(`INSERT INTO recipe_components (recipe_id, source_ingredient_id, quantite, unite, role, ordre) VALUES ($1, $2, 100, 'g', 'ingredient', 1)`, [baseId, sucreId]);
    await testPool().query(`INSERT INTO recipe_format_components (format_id, source_ingredient_id, quantite, unite, role, ordre) VALUES ($1, $2, 100, 'g', 'ingredient', 1)`, [formatId, sucreId]);
    await testPool().query(`UPDATE recipes SET margin_multiplier = 4, hydratation_pct = 70, etapes = '[]' WHERE id = $1`, [baseId]);
    await testPool().query(`UPDATE recipe_formats SET quantite_par_format = 1200 WHERE id = $1`, [formatId]);

    const result = await restoreRecipeVersion(baseId, 1, fx.userId);
    expect(result.restoredFrom).toBe(1);
    expect(result.newVersion).toBe(2);          // l'etat courant (modifie) est devenu la v2
    expect(result.warnings).toEqual([]);

    const rec = await testPool().query(`SELECT margin_multiplier, hydratation_pct, etapes FROM recipes WHERE id = $1`, [baseId]);
    expect(num(rec.rows[0].margin_multiplier)).toBe(3);
    expect(num(rec.rows[0].hydratation_pct)).toBe(65);
    expect(rec.rows[0].etapes).toHaveLength(1);

    const comps = await testPool().query(`SELECT source_ingredient_id, quantite FROM recipe_components WHERE recipe_id = $1`, [baseId]);
    expect(comps.rows).toHaveLength(1);
    expect(comps.rows[0].source_ingredient_id).toBe(farineId);
    expect(num(comps.rows[0].quantite)).toBe(600);

    const fmt = await testPool().query(`SELECT quantite_par_format, is_active FROM recipe_formats WHERE id = $1`, [formatId]);
    expect(num(fmt.rows[0].quantite_par_format)).toBe(1000);   // format existant mis a jour, meme id
    expect(fmt.rows[0].is_active).toBe(true);
    const fcomps = await testPool().query(`SELECT source_ingredient_id FROM recipe_format_components WHERE format_id = $1`, [formatId]);
    expect(fcomps.rows.map((r: Record<string, unknown>) => r.source_ingredient_id)).toEqual([farineId]);

    // La v2 contient bien l'etat modifie : on peut y revenir.
    const v2 = await testPool().query(`SELECT snapshot, change_note FROM recipe_versions WHERE recipe_id = $1 AND version_number = 2`, [baseId]);
    expect(v2.rows[0].snapshot.components).toHaveLength(2);
    expect(num(v2.rows[0].snapshot.recipe.margin_multiplier)).toBe(4);
    expect(v2.rows[0].change_note).toMatch(/Avant restauration de la version 1/);
  });

  it('revenir a la v2 re-applique l\'etat modifie (aller-retour)', async () => {
    const result = await restoreRecipeVersion(baseId, 2, fx.userId);
    expect(result.newVersion).toBe(3);
    const comps = await testPool().query(`SELECT count(*)::int AS n FROM recipe_components WHERE recipe_id = $1`, [baseId]);
    expect(comps.rows[0].n).toBe(2);
    const rec = await testPool().query(`SELECT margin_multiplier FROM recipes WHERE id = $1`, [baseId]);
    expect(num(rec.rows[0].margin_multiplier)).toBe(4);
  });

  it('ignore un ingredient disparu avec un avertissement, et refuse une version sans capture', async () => {
    // Supprime le sucre du referentiel : la v2 (qui le contient) doit se restaurer sans lui.
    await testPool().query(`DELETE FROM recipe_components WHERE source_ingredient_id = $1`, [sucreId]);
    await testPool().query(`DELETE FROM recipe_format_components WHERE source_ingredient_id = $1`, [sucreId]);
    await testPool().query(`DELETE FROM ingredients WHERE id = $1`, [sucreId]);
    fx.ids.ingredients = fx.ids.ingredients.filter(id => id !== sucreId);

    const result = await restoreRecipeVersion(baseId, 2, fx.userId);
    expect(result.warnings.some(w => /disparu/.test(w))).toBe(true);
    const comps = await testPool().query(`SELECT count(*)::int AS n FROM recipe_components WHERE recipe_id = $1`, [baseId]);
    expect(comps.rows[0].n).toBe(1);

    // Version historique sans snapshot (avant mig 346) : refus explicite.
    await testPool().query(
      `INSERT INTO recipe_versions (recipe_id, version_number, name, yield_quantity, is_base, ingredients, sub_recipes) VALUES ($1, 99, 'legacy', 1, true, '[]', '[]')`,
      [baseId]
    );
    await expect(restoreRecipeVersion(baseId, 99, fx.userId)).rejects.toMatchObject({ code: 'NO_SNAPSHOT' });
    await expect(restoreRecipeVersion(baseId, 123, fx.userId)).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND' });
  });
});
