/**
 * M4-07 — champs personnalisés sur fiches techniques, ordres et lots (mig 565).
 * Un champ obligatoire par type ; enregistrement contrôlé (type, obligatoire) par le
 * moteur de la migration 369, valeur relue sur la fiche.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, createProductWithRecipe, cleanupFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Champs personnalisés production (M4-07)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let cf: typeof import('../../services/custom-fields.js');
  let fx: Fixtures; let recipeId: string; let planId: string; const defIds: string[] = [];
  const p = () => testPool();
  const code = `m407_${RUN}`.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 39);

  beforeAll(async () => {
    repos = await importRepositories();
    cf = await import('../../services/custom-fields.js');
    fx = await createBaseFixtures();
    const d = await createProductWithRecipe(fx, { name: 'Pain M407', price: 3, ingredients: [] });
    recipeId = d.recipeId;
    const pl = await repos.productionRepository.create({ planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId, items: [{ productId: d.productId, plannedQuantity: 5 }] });
    planId = pl.id; fx.ids.plans.push(planId);
    for (const [entity, type] of [['recipe', 'text'], ['production_order', 'number'], ['product_lot', 'date']] as const) {
      defIds.push((await p().query(
        `INSERT INTO custom_field_defs (entity, code, label, field_type, required) VALUES ($1, $2, $3, $4, true) RETURNING id`,
        [entity, code, `Champ ${entity}`, type])).rows[0].id);
    }
  }, 60_000);

  afterAll(async () => {
    await p().query(`UPDATE custom_field_defs SET is_active = false WHERE id = ANY($1::uuid[])`, [defIds]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('fiche technique et ordre : valeur contrôlée puis relue', async () => {
    expect((await cf.saveValues('recipe', recipeId, { [code]: 'Norme ISO 22000' })).data?.[code]).toBe('Norme ISO 22000');
    expect(await cf.readValues('recipe', recipeId)).toMatchObject({ [code]: 'Norme ISO 22000' });
    const bad = await cf.saveValues('production_order', planId, { [code]: 'abc' });
    expect(bad.error).toBe('invalid');
    expect((await cf.saveValues('production_order', planId, { [code]: '12,5' })).data?.[code]).toBe(12.5);
    const missing = await cf.saveValues('production_order', planId, { [code]: '' });
    expect(missing.error).toBe('invalid');
  });

  it('lot produit : date au format français', async () => {
    const lot = (await p().query(
      `INSERT INTO product_lots (product_id, store_id, lot_number, quantity_total, produced_at, production_plan_id)
       SELECT ppi.product_id, $2, $3, 5, now(), $1 FROM production_plan_items ppi WHERE ppi.plan_id = $1 RETURNING id`,
      [planId, fx.storeId, `L-M407-${RUN}`])).rows[0].id;
    expect((await cf.saveValues('product_lot', lot, { [code]: '17/11/2026' })).data?.[code]).toBe('2026-11-17');
    expect(cf.isCfEntity('product_lot')).toBe(true);
  });

  it('générateur de rapports : regrouper et sommer par champ personnalisé de l\'ordre', async () => {
    const { reportBuilderRepository: rb } = await import('../../repositories/report-builder.repository.js');
    const src = (await rb.listSources()).find(s => s.key === 'production')!;
    expect(src.dimensions.map(d => d.key)).toContain(`cf.production_order.${code}`);
    expect(src.dimensions.map(d => d.key)).toContain(`cf.recipe.${code}`);
    const today = new Date().toISOString().slice(0, 10);
    const out = await rb.run({ sourceKey: 'production', dimensions: [`cf.production_order.${code}`, `cf.recipe.${code}`],
      measures: ['planned', `cf.production_order.${code}.sum`], filters: { [`cf.production_order.${code}`]: '12.5' }, dateFrom: today, dateTo: today }, { storeId: fx.storeId });
    expect('error' in out).toBe(false);
    const rows = (out as { rows: Record<string, unknown>[] }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ [`cf.production_order.${code}`]: '12.5', [`cf.recipe.${code}`]: 'Norme ISO 22000' });
    expect(Number(rows[0][`cf.production_order.${code}.sum`])).toBeCloseTo(12.5, 3);
    expect((await rb.listSources()).find(s => s.key === 'lots')!.dimensions.map(d => d.key)).toContain(`cf.product_lot.${code}`);
  });

  it('import : champs personnalisés d\'un lot mis à jour par son numéro ; nom de fiche ambigu refusé', async () => {
    const di = await import('../../services/data-import.js');
    const csv = Buffer.from(`N° de lot;Champ product_lot\nL-M407-${RUN};18/11/2026\n`, 'utf8');
    const res = await di.commitImport(di.entityByKey('product_lots')!, csv, { actorId: fx.userId, mode: 'update', fileName: 'lots.csv' });
    expect(res).toMatchObject({ ok: true, updated: 1, created: 0 });
    expect((await p().query(`SELECT custom_fields->>$2 AS v, lot_number FROM product_lots WHERE lot_number = $1`, [`L-M407-${RUN}`, code])).rows[0])
      .toMatchObject({ v: '2026-11-18', lot_number: `L-M407-${RUN}` });

    const twin = `Doublon M407 ${RUN}`;
    const a = await createProductWithRecipe(fx, { name: 'Twin A M407', price: 1, ingredients: [] });
    const b = await createProductWithRecipe(fx, { name: 'Twin B M407', price: 1, ingredients: [] });
    await p().query(`UPDATE recipes SET name = $1 WHERE id = ANY($2::uuid[])`, [twin, [a.recipeId, b.recipeId]]);
    const prev = await di.previewImport(di.entityByKey('recipes')!, Buffer.from(`Nom de la fiche;Champ recipe\n${twin};Lot de test\n`, 'utf8'), { mode: 'update' });
    expect(prev.rows[0].action).toBe('error');
    expect(prev.rows[0].errors.map(e => e.message).join(' ')).toMatch(/plusieurs fiches/);
  });
});
