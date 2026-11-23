/**
 * M4-05 (étape 4) — remplacement en masse comme outil de mise à jour (mig 594) :
 *  - remplacement sur les seules fiches choisies, quantités × ratio, annulation exacte ;
 *  - mode « substitut » : B déclaré substitut de A sans toucher la composition, annulable ;
 *  - après remplacement, la nouvelle version de la fiche s'active (circuit M4-03).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, createProductWithRecipe, cleanupFixtures, num, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Remplacement en masse et substituts (M4-05)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let recipeRepo: typeof import('../../repositories/recipe.repository.js')['recipeRepository'];
  let bom: typeof import('../../repositories/bom-version.repository.js')['bomVersionRepository'];
  let activate: typeof import('../../services/bom-version-activation.js')['activateBomVersion'];
  let fx: Fixtures; let a: string; let b: string; let r1: string; let r2: string;
  const logs: string[] = [];
  const p = () => testPool();
  const qty = async (recipeId: string, ing: string) =>
    (await p().query(
      `SELECT fc.quantite AS quantity FROM recipe_format_components fc JOIN recipe_formats f ON f.id = fc.format_id
        WHERE f.recipe_id = $1 AND f.is_default AND fc.source_ingredient_id = $2`, [recipeId, ing])).rows.map(r => num(r.quantity));

  beforeAll(async () => {
    repos = await importRepositories();
    recipeRepo = (await import('../../repositories/recipe.repository.js')).recipeRepository;
    bom = (await import('../../repositories/bom-version.repository.js')).bomVersionRepository;
    activate = (await import('../../services/bom-version-activation.js')).activateBomVersion;
    fx = await createBaseFixtures();
    a = await createIngredient(fx, { name: 'Beurre M405', unit: 'kg', unitCost: 90 });
    b = await createIngredient(fx, { name: 'Margarine M405', unit: 'kg', unitCost: 40 });
    r1 = (await createProductWithRecipe(fx, { name: 'Croissant M405', price: 3, ingredients: [{ ingredientId: a, quantity: 0.2, unit: 'kg' }] })).recipeId;
    r2 = (await createProductWithRecipe(fx, { name: 'Brioche M405', price: 3, ingredients: [{ ingredientId: a, quantity: 0.1, unit: 'kg' }] })).recipeId;
    await bom.activate(r1, { reason: 'Version 1' }, fx.userId);
  }, 60_000);

  afterAll(async () => {
    const run = async (sql: string, params: unknown[]) => { try { await p().query(sql, params); } catch { /* best effort */ } };
    await run(`DELETE FROM recipe_bulk_replace_log WHERE id = ANY($1::uuid[])`, [logs]);
    await run(`DELETE FROM recipe_line_substitutes WHERE ingredient_id = $1`, [a]);
    await run(`DELETE FROM approval_requests WHERE doc_type = 'bom_change' AND doc_id IN (SELECT id FROM bom_versions WHERE recipe_id = ANY($1::uuid[]))`, [[r1, r2]]);
    await run(`DELETE FROM bom_versions WHERE recipe_id = ANY($1::uuid[])`, [[r1, r2]]);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('remplacement sur une seule fiche, quantités × ratio, puis annulation exacte', async () => {
    const res = await recipeRepo.applyBulkReplace(a, b, fx.userId, { ratio: 1.25, recipeIds: [r1] });
    logs.push(res.log_id!);
    expect(res).toMatchObject({ mode: 'replace', rows_count: 1, recipes_count: 1, recipe_ids: [r1] });
    expect(await qty(r1, b)).toEqual([0.25]);
    expect(await qty(r2, a)).toEqual([0.1]); // fiche non choisie : intacte
    const back = await recipeRepo.revertBulkReplace(res.log_id!, fx.userId);
    expect(back).toMatchObject({ ok: true, restored: 1 });
    expect(await qty(r1, a)).toEqual([0.2]);
    expect(await qty(r1, b)).toEqual([]);
  });

  it('mode substitut : la composition ne change pas, le substitut est créé puis retiré', async () => {
    const res = await recipeRepo.applyBulkReplace(a, b, fx.userId, { mode: 'substitute', ratio: 1.1, recipeIds: [r1, r2], priority: 2 });
    logs.push(res.log_id!);
    expect(res).toMatchObject({ mode: 'substitute', rows_count: 2 });
    expect(await qty(r1, a)).toEqual([0.2]);
    const subs = (await p().query(`SELECT recipe_id, ratio, priority FROM recipe_line_substitutes WHERE ingredient_id = $1 AND substitute_ingredient_id = $2`, [a, b])).rows;
    expect(subs).toHaveLength(2);
    expect(num(subs[0].ratio)).toBeCloseTo(1.1, 4);
    expect(subs[0].priority).toBe(2);
    await recipeRepo.revertBulkReplace(res.log_id!, fx.userId);
    expect((await p().query(`SELECT 1 FROM recipe_line_substitutes WHERE ingredient_id = $1 AND substitute_ingredient_id = $2`, [a, b])).rows).toHaveLength(0);
  });

  it('après remplacement, la nouvelle version de la fiche s\'active', async () => {
    const res = await recipeRepo.applyBulkReplace(a, b, fx.userId, { recipeIds: [r1] });
    logs.push(res.log_id!);
    expect((await bom.list(r1)).pendingChanges).toBe(true);
    const v = await activate(r1, { reason: 'Remplacement en masse' }, fx.userId) as { version_no?: number; pending?: boolean };
    if (!v.pending) {
      expect(v.version_no).toBe(2);
      expect((await bom.list(r1)).pendingChanges).toBe(false);
    }
    await recipeRepo.markBulkReplaceVersions(res.log_id!, v.pending ? 0 : 1);
    const log = (await recipeRepo.listBulkReplaceLogs(50)).find((l: { id: string }) => l.id === res.log_id);
    expect(log).toMatchObject({ mode: 'replace', ratio: 1 });
  });
});
