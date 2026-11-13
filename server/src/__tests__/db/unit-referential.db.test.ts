/**
 * Unités libres (mig 515) : la liste vient du référentiel `units`. Une matière se
 * stocke au mètre ; une ligne de fiche dans une unité qui ne se convertit pas vers
 * l'unité de stock est refusée (fn_unit_conv ne convertit que masse et volume).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories } from './helpers.js';

describe.skipIf(!hasTestDb)('Unités libres', () => {
  let units: typeof import('../../services/unit-referential.js');
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  const p = () => testPool();

  const run = (mw: (req: any, res: any, next: (e?: unknown) => void) => Promise<void>, body: unknown, params: Record<string, string> = {}) =>
    new Promise<{ code: number; message?: string }>((resolve, reject) => {
      const res = { status: (code: number) => ({ json: (b: { error?: { message?: string } }) => resolve({ code, message: b.error?.message }) }) };
      mw({ body, params }, res, (err?: unknown) => (err ? reject(err) : resolve({ code: 200 })));
    });

  beforeAll(async () => {
    repos = await importRepositories();
    units = await import('../../services/unit-referential.js');
  });

  afterAll(async () => {
    await p().query(`DELETE FROM recipe_ingredients WHERE ingredient_id IN (SELECT id FROM ingredients WHERE name LIKE 'U515 %')`).catch(() => undefined);
    await p().query(`DELETE FROM recipes WHERE name = 'U515 fiche'`).catch(() => undefined);
    await p().query(`DELETE FROM ingredients WHERE name LIKE 'U515 %'`).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('la base accepte une unité du référentiel et refuse une unité inconnue', async () => {
    await p().query(`INSERT INTO ingredients (name, unit, unit_cost) VALUES ('U515 tube', 'm', 22)`);
    await expect(p().query(`INSERT INTO ingredients (name, unit, unit_cost) VALUES ('U515 x', 'zz', 1)`))
      .rejects.toThrow(/Unité inconnue : zz/);
    expect((await units.activeUnits()).map(u => u.code)).toEqual(expect.arrayContaining(['kg', 'm', 'm2']));
  });

  it('une ligne de fiche doit être convertible vers l\'unité de stock', async () => {
    const { rows } = await p().query(`SELECT id FROM ingredients WHERE name = 'U515 tube'`);
    const tube = rows[0].id as string;
    const guard = units.requireUnits((b: { lines: { unit: string; ingredientId?: string }[] }) => b.lines);

    expect((await run(guard, { lines: [{ unit: 'm', ingredientId: tube }] })).code).toBe(200);
    const mixed = await run(guard, { lines: [{ unit: 'g', ingredientId: tube }] });
    expect(mixed.code).toBe(400);
    expect(mixed.message).toContain('ne se convertit pas en « m »');
    expect((await run(guard, { lines: [{ unit: 'pouce' }] })).message).toMatch(/Unité inconnue : pouce/);
    // Couples historiques inchangés (masse, volume, et même pièce ↔ kg comme avant).
    expect(units.lineUnitError('g', 'kg')).toBeNull();
    expect(units.lineUnitError('unit', 'kg')).toBeNull();
  });

  it('changer l\'unité de stock d\'une matière utilisée en grammes vers le mètre est refusé', async () => {
    const ing = (await p().query(`INSERT INTO ingredients (name, unit, unit_cost) VALUES ('U515 tôle', 'kg', 14) RETURNING id`)).rows[0].id;
    const rec = (await p().query(`INSERT INTO recipes (name) VALUES ('U515 fiche') RETURNING id`)).rows[0].id;
    await p().query(`INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ($1, $2, 500, 'g')`, [rec, ing]);

    const guard = units.requireStockUnitChange();
    expect((await run(guard, { unit: 'm' }, { id: ing })).code).toBe(400);
    expect((await run(guard, { unit: 'g' }, { id: ing })).code).toBe(200);
  });
});
