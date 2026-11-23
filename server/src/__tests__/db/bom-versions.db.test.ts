/**
 * M4-01 — versions de nomenclature (mig 559).
 *  - activer fige le contenu de la fiche en version active ;
 *  - modifier la fiche la met « en modification non activée », avec la liste des écarts ;
 *  - activer à nouveau crée la version 2 active et rend la 1 obsolète la veille ;
 *  - une version figée ne peut plus être modifiée ; activer sans changement est refusé.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, createProductWithRecipe, cleanupFixtures, setIngredientQty, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Versions de nomenclature (M4-01)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let bom: typeof import('../../repositories/bom-version.repository.js')['bomVersionRepository'];
  let fx: Fixtures; let recipeId: string; let flour: string;
  const p = () => testPool();

  beforeAll(async () => {
    repos = await importRepositories();
    bom = (await import('../../repositories/bom-version.repository.js')).bomVersionRepository;
    fx = await createBaseFixtures();
    flour = await createIngredient(fx, { name: 'Farine M401', unit: 'kg', unitCost: 8 });
    recipeId = (await createProductWithRecipe(fx, { name: 'Pain M401', price: 3, ingredients: [{ ingredientId: flour, quantity: 0.5, unit: 'kg' }] })).recipeId;
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM bom_versions WHERE recipe_id = $1`, [recipeId]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('version 1 active, fiche à jour', async () => {
    const v1 = await bom.activate(recipeId, { reason: 'Première version' }, fx.userId);
    expect(v1).toMatchObject({ version_no: 1, status: 'active' });
    expect((await bom.list(recipeId)).pendingChanges).toBe(false);
    await expect(bom.activate(recipeId, { reason: 'Rien' }, fx.userId)).rejects.toThrow(/Aucune modification/);
  });

  it('modifier la fiche : modification non activée, écarts listés', async () => {
    await setIngredientQty(recipeId, flour, 0.6);
    expect((await bom.list(recipeId)).pendingChanges).toBe(true);
    // Nouveau modèle (pas 2b-1) : l'écart apparaît dans le miroir de la fiche et dans le format par défaut.
    expect(await bom.pendingDiff(recipeId)).toEqual([
      expect.objectContaining({ section: 'Composants', change: 'quantite', before: '0.5 kg', after: '0.6 kg' }),
      expect.objectContaining({ section: 'Format 1 (défaut)', change: 'quantite', before: '0.5 kg', after: '0.6 kg' }),
    ]);
  });

  it('activer la version 2 rend la 1 obsolète ; la 1 reste figée', async () => {
    const v2 = await bom.activate(recipeId, { reason: 'Plus de farine' }, fx.userId);
    expect(v2).toMatchObject({ version_no: 2, status: 'active' });
    const list = (await bom.list(recipeId)).versions;
    const v1 = list.find((v: { version_no: number }) => v.version_no === 1);
    expect(v1).toMatchObject({ status: 'obsolete' });
    expect(v1.valid_to < v2.valid_from).toBe(true);
    expect(await bom.compare(recipeId, 1, 2)).toHaveLength(2); // miroir + format par défaut
    await expect(p().query(`UPDATE bom_versions SET snapshot = '{}'::jsonb WHERE recipe_id = $1 AND version_no = 1`, [recipeId])).rejects.toThrow(/VERSION_FIGEE/);
    await expect(p().query(`UPDATE bom_versions SET status = 'active', valid_to = NULL WHERE recipe_id = $1 AND version_no = 1`, [recipeId])).rejects.toThrow(/VERSION_FIGEE|uq_bom_versions_one_active/);
  });
});
