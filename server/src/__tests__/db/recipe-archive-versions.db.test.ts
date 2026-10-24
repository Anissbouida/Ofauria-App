/**
 * Archivage et versioning complet des recettes (mig 346), sur base migree.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createProductWithRecipe, cleanupFixtures, num, type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Recettes — archivage et versions completes', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let recipeRepository: typeof import('../../repositories/recipe.repository.js')['recipeRepository'];
  let snapshotRecipeVersion: typeof import('../../repositories/recipe-version.helper.js')['snapshotRecipeVersion'];
  let fx: Fixtures;
  let recipeId: string; let baseId: string; let farineId: string;

  beforeAll(async () => {
    repos = await importRepositories();
    ({ recipeRepository } = await import('../../repositories/recipe.repository.js'));
    ({ snapshotRecipeVersion } = await import('../../repositories/recipe-version.helper.js'));
    fx = await createBaseFixtures();
    farineId = await createIngredient(fx, { name: 'Farine V', unit: 'kg', unitCost: 10, allergens: ['gluten'] });
    const pr = await createProductWithRecipe(fx, {
      name: 'Pain V', price: 4, ingredients: [{ ingredientId: farineId, quantity: 0.6, unit: 'kg' }],
    });
    recipeId = pr.recipeId;
    // Preparation de base composee, avec une etape et des frais, pour la capture.
    const base = await testPool().query(
      `INSERT INTO recipes (name, yield_quantity, yield_unit, mode_cout, is_base, etapes, taux_main_oeuvre_dh_h, main_oeuvre_min, hydratation_pct)
       VALUES ($1, 1, 'kg', 'compose', true, $2, 35, 20, 65) RETURNING id`,
      [`Pate V ${Date.now()}`, JSON.stringify([{ ordre: 1, nom: 'Petrissage', type: 'petrissage', duree_estimee_min: 12, temperature_c: 25 }])]
    );
    baseId = base.rows[0].id; fx.ids.recipes.push(baseId);
    await testPool().query(
      `INSERT INTO recipe_components (recipe_id, source_ingredient_id, quantite, unite, role) VALUES ($1, $2, 600, 'g', 'ingredient')`,
      [baseId, farineId]
    );
    const fmt = await testPool().query(
      `INSERT INTO recipe_formats (recipe_id, quantite_par_format, nb_par_defaut, is_default, is_active) VALUES ($1, 1000, 1, true, true) RETURNING id`,
      [baseId]
    );
    await testPool().query(
      `INSERT INTO recipe_format_components (format_id, source_ingredient_id, quantite, unite, role) VALUES ($1, $2, 600, 'g', 'ingredient')`,
      [fmt.rows[0].id, farineId]
    );
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('la capture complete contient composants, formats, etapes, frais et cout', async () => {
    const version = await snapshotRecipeVersion(repos.db, baseId, fx.userId, 'test capture');
    expect(version).toBe(1);
    const rows = await testPool().query(`SELECT snapshot, ingredients, change_note, changed_by FROM recipe_versions WHERE recipe_id = $1`, [baseId]);
    expect(rows.rows).toHaveLength(1);
    const s = rows.rows[0].snapshot;
    expect(s.components).toHaveLength(1);
    expect(s.components[0].source_ingredient_id).toBe(farineId);
    expect(s.formats).toHaveLength(1);
    expect(s.formats[0].components).toHaveLength(1);
    expect(s.etapes[0].type).toBe('petrissage');
    expect(num(s.recipe.taux_main_oeuvre_dh_h)).toBe(35);
    expect(s.recipe.main_oeuvre_min).toBe(20);
    expect(num(s.recipe.hydratation_pct)).toBe(65);
    expect(num(s.recipe.total_cost)).toBeCloseTo(6, 3); // 600 g x 10 DH/kg
    expect(rows.rows[0].change_note).toBe('test capture');
    expect(rows.rows[0].changed_by).toBe(fx.userId);
    // Les colonnes historiques restent remplies (UI existante) : ici legacy vide, compose capture a part.
    expect(rows.rows[0].ingredients).toEqual([]);
  });

  it('une modification de nomenclature par format versionne AVANT d\'ecrire', async () => {
    const { recipeComponentRepository } = await import('../../repositories/recipe-component.repository.js');
    const fmt = await testPool().query(`SELECT id FROM recipe_formats WHERE recipe_id = $1`, [baseId]);
    await recipeComponentRepository.replaceForFormat(baseId, fmt.rows[0].id, {
      components: [{ sourceIngredientId: farineId, quantite: 700, unite: 'g', ordre: 0, role: 'ingredient' }],
    } as any, fx.userId);
    const versions = await testPool().query(`SELECT version_number, snapshot FROM recipe_versions WHERE recipe_id = $1 ORDER BY version_number`, [baseId]);
    expect(versions.rows).toHaveLength(2);
    // La v2 capture l'etat d'AVANT (600 g), la base contient maintenant 700 g.
    expect(num(versions.rows[1].snapshot.components[0].quantite)).toBe(600);
    const now = await testPool().query(`SELECT quantite FROM recipe_components WHERE recipe_id = $1`, [baseId]);
    expect(num(now.rows[0].quantite)).toBe(700);
  });

  it('archiver sort la fiche des listes et des selecteurs, restaurer la ramene', async () => {
    const inActive = (rows: Record<string, unknown>[]) => rows.some(r => r.id === baseId);

    expect(inActive(await recipeRepository.findAll())).toBe(true);
    expect(inActive(await recipeRepository.findBaseRecipes())).toBe(true);

    const archived = await recipeRepository.archive([baseId], fx.userId);
    expect(archived.archivedCount).toBe(1);
    expect(inActive(await recipeRepository.findAll())).toBe(false);
    expect(inActive(await recipeRepository.findAll(true))).toBe(true);
    expect(inActive(await recipeRepository.findBaseRecipes())).toBe(false);
    // Toujours lisible par id (historique de production) et jamais supprimee.
    const byId = await recipeRepository.findById(baseId);
    expect(byId?.archived_at).not.toBeNull();
    expect(byId?.archived_by).toBe(fx.userId);
    // Idempotent.
    expect((await recipeRepository.archive([baseId], fx.userId)).archivedCount).toBe(0);

    const restored = await recipeRepository.restore([baseId]);
    expect(restored.restoredCount).toBe(1);
    expect(inActive(await recipeRepository.findAll())).toBe(true);
    expect(inActive(await recipeRepository.findBaseRecipes())).toBe(true);
    expect((await recipeRepository.findById(baseId))?.archived_at).toBeNull();
  });

  it('le produit fini lie a une recette archivee garde sa recette', async () => {
    await recipeRepository.archive([recipeId], fx.userId);
    const byProduct = await recipeRepository.findByProductId(fx.ids.products[0]);
    expect(byProduct?.id).toBe(recipeId);
    await recipeRepository.restore([recipeId]);
  });
});
