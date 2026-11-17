/**
 * M5-03 — reprise des étapes JSON en gamme (routingRepriseRepository).
 * Fiche avec deux étapes (dont une sans durée, une bloquante avec contrôle et libellé arabe) :
 *  - le rapport signale l'étape sans durée et les étapes sans poste ;
 *  - la reprise crée une gamme rattachée à la fiche, une opération par étape, dans l'ordre ;
 *  - une seconde reprise ne crée rien (fiche déjà dotée d'une gamme) ; le JSON reste en base.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createProductWithRecipe, cleanupFixtures, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Reprise des étapes en gamme (M5-03)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let rep: typeof import('../../repositories/routing-reprise.repository.js')['routingRepriseRepository'];
  let rr: typeof import('../../repositories/routing.repository.js')['routingRepository'];
  let fx: Fixtures; let recipeId: string; const routingIds: string[] = [];
  const p = () => testPool();
  const etapes = [
    { ordre: 2, nom: 'Cuisson', duree_estimee_min: 20, est_bloquante: true, controle_qualite: true, temperature_c: 180, nom_ar: 'الطياب', checklist_items: ['Dorure uniforme'] },
    { ordre: 1, nom: 'Façonnage', est_bloquante: false },
  ];

  beforeAll(async () => {
    repos = await importRepositories();
    rep = (await import('../../repositories/routing-reprise.repository.js')).routingRepriseRepository;
    rr = (await import('../../repositories/routing.repository.js')).routingRepository;
    fx = await createBaseFixtures();
    recipeId = (await createProductWithRecipe(fx, { name: 'Torsade M503', price: 3, ingredients: [] })).recipeId;
    await p().query(`UPDATE recipes SET etapes = $2::jsonb WHERE id = $1`, [recipeId, JSON.stringify(etapes)]);
  }, 60_000);

  afterAll(async () => {
    for (const id of routingIds) await rr.deleteRouting(id).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('rapport : étapes sans durée et sans poste, rien d\'écrit', async () => {
    const [line] = await rep.report([recipeId]);
    expect(line).toMatchObject({ steps: 2, steps_without_duration: 1, steps_without_work_center: 2, action: 'creer' });
    expect((await p().query(`SELECT count(*)::int AS n FROM routings WHERE recipe_id = $1`, [recipeId])).rows[0].n).toBe(0);
  });

  it('reprise : une opération par étape, dans l\'ordre, puis plus rien à créer', async () => {
    const created = await rep.apply(fx.userId, [recipeId]);
    expect(created).toHaveLength(1);
    routingIds.push(created[0].routing_id);
    const r = await rr.getRoutingForRecipe(recipeId);
    const ops = r!.operations as Record<string, any>[];
    expect(ops.map(o => o.operation_name)).toEqual(['Façonnage', 'Cuisson']);
    expect(ops[1]).toMatchObject({ duration_min: 20, is_blocking: true, op_type: 'controle', temperature_c: 180, operation_name_ar: 'الطياب', instructions: 'Dorure uniforme' });
    expect(await rep.apply(fx.userId, [recipeId])).toEqual([]);
    expect((await rep.report([recipeId]))[0].action).toBe('deja_une_gamme');
    expect((await p().query(`SELECT jsonb_array_length(etapes) AS n FROM recipes WHERE id = $1`, [recipeId])).rows[0].n).toBe(2);
  });
});
