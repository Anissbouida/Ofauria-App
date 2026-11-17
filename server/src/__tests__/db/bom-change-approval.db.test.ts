/**
 * M4-03 — approbation d'une modification de nomenclature (mig 561, type bom_change).
 * Règle : écart de coût ≥ 5 % → approbation par un administrateur.
 *  - écart nul : activation directe (comportement d'avant) ;
 *  - coût doublé, demandé par un gérant : version 2 en brouillon, en attente ;
 *    l'impact donne le coût avant / après et les ordres ouverts ;
 *  - approuvée : la version 2 devient active ; refusée : le brouillon est retiré.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createIngredient, createProductWithRecipe, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Approbation d\'une modification de nomenclature (M4-03)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let act: typeof import('../../services/bom-version-activation.js')['activateBomVersion'];
  let approvals: typeof import('../../services/approval.service.js')['approvalService'];
  let bom: typeof import('../../repositories/bom-version.repository.js')['bomVersionRepository'];
  let fx: Fixtures; let recipeId: string; let manager: string; let ruleId: string;
  const p = () => testPool();
  const pendingRequest = async () => (await p().query(
    `SELECT r.id FROM approval_requests r JOIN bom_versions b ON b.id::text = r.doc_id WHERE r.doc_type = 'bom_change' AND r.status = 'pending' AND b.recipe_id = $1`, [recipeId])).rows[0]?.id;

  beforeAll(async () => {
    repos = await importRepositories();
    await import('../../services/approval-handlers.js');
    act = (await import('../../services/bom-version-activation.js')).activateBomVersion;
    approvals = (await import('../../services/approval.service.js')).approvalService;
    bom = (await import('../../repositories/bom-version.repository.js')).bomVersionRepository;
    fx = await createBaseFixtures();
    manager = (await p().query(`INSERT INTO users (email, password_hash, first_name, last_name, role, store_id) VALUES ($1, 'x', 'Gérant', 'M403', 'manager', $2) RETURNING id`,
      [`manager-m403-${RUN}@test.local`, fx.storeId])).rows[0].id;
    ruleId = (await p().query(`INSERT INTO approval_rules (code, label, doc_type, condition) VALUES ($1, 'Écart de coût', 'bom_change', '{"field":"cost_change_pct","op":"gte","value":5}') RETURNING id`,
      [`m403_${RUN}`.slice(0, 40).toLowerCase().replace(/[^a-z0-9_]/g, '_')])).rows[0].id;
    await p().query(`INSERT INTO approval_rule_steps (rule_id, step_order, approver_role) VALUES ($1, 1, 'admin')`, [ruleId]);
    const flour = await createIngredient(fx, { name: 'Farine M403', unit: 'kg', unitCost: 10 });
    recipeId = (await createProductWithRecipe(fx, { name: 'Pain M403', price: 3, ingredients: [{ ingredientId: flour, quantity: 0.5, unit: 'kg' }] })).recipeId;
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM approval_requests WHERE doc_type = 'bom_change' AND doc_id IN (SELECT id::text FROM bom_versions WHERE recipe_id = $1)`, [recipeId]).catch(() => undefined);
    await p().query(`DELETE FROM approval_rules WHERE id = $1`, [ruleId]).catch(() => undefined);
    await p().query(`DELETE FROM bom_versions WHERE recipe_id = $1`, [recipeId]).catch(() => undefined);
    await p().query(`DELETE FROM users WHERE id = $1`, [manager]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('écart de coût nul : version active tout de suite', async () => {
    expect(await act(recipeId, { reason: 'Version 1' }, manager)).toMatchObject({ version_no: 1, status: 'active' });
  });

  it('coût doublé : brouillon en attente, impact calculé ; approuvée → active', async () => {
    await p().query(`UPDATE recipe_ingredients SET quantity = 1.0 WHERE recipe_id = $1`, [recipeId]);
    const r = await act(recipeId, { reason: 'Recette plus riche' }, manager) as { pending?: boolean; version_no: number; impact: { cost_change_pct: number; open_orders: number } };
    expect(r).toMatchObject({ pending: true, version_no: 2 });
    expect(r.impact.cost_change_pct).toBeCloseTo(100, 0);
    expect((await bom.list(recipeId)).versions.find((v: { version_no: number }) => v.version_no === 2).status).toBe('brouillon');
    await expect(act(recipeId, { reason: 'Encore' }, manager)).rejects.toThrow(/déjà en attente/);
    await approvals.decide(await pendingRequest(), { userId: fx.userId, role: 'admin' }, 'approve');
    const vs = (await bom.list(recipeId)).versions;
    expect(vs.find((v: { version_no: number }) => v.version_no === 2).status).toBe('active');
    expect(vs.find((v: { version_no: number }) => v.version_no === 1).status).toBe('obsolete');
  });

  it('refusée : le brouillon est retiré, la fiche garde ses modifications', async () => {
    await p().query(`UPDATE recipe_ingredients SET quantity = 2.0 WHERE recipe_id = $1`, [recipeId]);
    expect(await act(recipeId, { reason: 'Encore plus' }, manager)).toMatchObject({ pending: true, version_no: 3 });
    await approvals.decide(await pendingRequest(), { userId: fx.userId, role: 'admin' }, 'reject', 'Trop cher');
    const list = await bom.list(recipeId);
    expect(list.versions.map((v: { version_no: number }) => v.version_no)).toEqual([2, 1]);
    expect(list.pendingChanges).toBe(true);
  });
});
