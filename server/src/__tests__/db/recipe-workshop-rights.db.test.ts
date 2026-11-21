/**
 * Scénario 1, constat 106 — un chef ne modifie que les fiches de ses ateliers (mig 620).
 *  - atelier d'une fiche : catégorie du produit lié, sinon catégorie de production de la fiche ;
 *  - fiche commune (sans atelier) : modifiable par tout chef ;
 *  - production.all_workshops (gérant) : toutes les fiches ;
 *  - la garde refuse aussi de déplacer une fiche vers l'atelier d'un autre (catégorie envoyée).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createProductWithRecipe, cleanupFixtures, RUN, type Fixtures,
} from './helpers.js';

type Res = { statusCode: number; body: any; status(c: number): Res; json(b: unknown): Res };
const fakeRes = (): Res => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

describe.skipIf(!hasTestDb)('Fiches techniques : modification par atelier (constat 106)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let rw: typeof import('../../services/recipe-workshop.js');
  let fx: Fixtures;
  let pastryRecipe = '', commonRecipe = '', patCategory = '', boulCategory = '';
  const users: Record<string, string> = {};
  const createdUsers: string[] = [];
  const createdRecipes: string[] = [];
  const p = () => testPool();
  const user = (role: string) => ({ userId: users[role], role, baseRoles: [role] });
  const guard = async (role: string, recipeId: string | null, body?: Record<string, unknown>) => {
    const res = fakeRes(); let passed = false;
    await rw.recipeWorkshopGuard(recipeId ? 'recipe' : 'none', { body: !!body })(
      { params: recipeId ? { id: recipeId } : {}, body: body ?? {}, user: user(role) } as never, res as never, () => { passed = true; });
    return { passed, res };
  };

  beforeAll(async () => {
    repos = await importRepositories();
    rw = await import('../../services/recipe-workshop.js');
    fx = await createBaseFixtures();
    for (const role of ['pastry_chef', 'beldi_sale', 'manager']) {
      users[role] = (await p().query(
        `INSERT INTO users (email, password_hash, first_name, last_name, role, store_id)
         VALUES ($1, 'x', 'Test', $2, $2, $3) RETURNING id`, [`${role}-c106-${RUN}@test.local`, role, fx.storeId])).rows[0].id;
      createdUsers.push(users[role]);
    }
    const pastryCat = (await p().query(`SELECT category_id FROM production_workshop_categories WHERE workshop_code = 'pastry_chef' LIMIT 1`)).rows[0].category_id;
    patCategory = (await p().query(`SELECT recipe_category_id FROM production_workshop_recipe_categories WHERE workshop_code = 'pastry_chef' LIMIT 1`)).rows[0].recipe_category_id;
    boulCategory = (await p().query(`SELECT recipe_category_id FROM production_workshop_recipe_categories WHERE workshop_code = 'baker' LIMIT 1`)).rows[0].recipe_category_id;

    const farine = await createIngredient(fx, { name: 'Farine C106', unit: 'kg', unitCost: 10 });
    const made = await createProductWithRecipe(fx, { name: 'Éclair C106', price: 12, shelfLifeDays: null,
      ingredients: [{ ingredientId: farine, quantity: 0.05, unit: 'kg' }] });
    await p().query(`UPDATE products SET category_id = $1 WHERE id = $2`, [pastryCat, made.productId]);
    pastryRecipe = made.recipeId;
    commonRecipe = (await p().query(`INSERT INTO recipes (name, is_base) VALUES ($1, true) RETURNING id`, [`Ganache C106 ${RUN}`])).rows[0].id;
    createdRecipes.push(commonRecipe);
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM recipes WHERE id = ANY($1::uuid[])`, [createdRecipes]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await p().query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUsers]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('atelier d\'une fiche : catégorie du produit, sinon catégorie de fiche, sinon commune', async () => {
    expect(await rw.recipeWorkshop(pastryRecipe)).toBe('pastry_chef');
    expect(await rw.recipeWorkshop(commonRecipe)).toBeNull();
    expect(await rw.workshopFor(null, patCategory)).toBe('pastry_chef');
  });

  it('la cheffe beldi ne modifie pas une fiche de pâtisserie (403 WORKSHOP_FORBIDDEN)', async () => {
    const { passed, res } = await guard('beldi_sale', pastryRecipe);
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('WORKSHOP_FORBIDDEN');
    expect(res.body.error.message).toMatch(/atelier/);
    expect(await rw.canEditRecipe(user('beldi_sale'), pastryRecipe)).toBe(false);
  });

  it('le pâtissier la modifie ; le gérant aussi', async () => {
    expect((await guard('pastry_chef', pastryRecipe)).passed).toBe(true);
    expect((await guard('manager', pastryRecipe)).passed).toBe(true);
    expect(await rw.canEditRecipe(user('manager'), pastryRecipe)).toBe(true);
  });

  it('une fiche commune reste modifiable par tout chef', async () => {
    expect((await guard('beldi_sale', commonRecipe)).passed).toBe(true);
  });

  it('pas de création ni de déplacement vers l\'atelier d\'un autre', async () => {
    expect((await guard('pastry_chef', null, { name: 'Pain C106', categoryId: boulCategory })).passed).toBe(false);
    expect((await guard('pastry_chef', null, { name: 'Tarte C106', categoryId: patCategory })).passed).toBe(true);
    expect((await guard('pastry_chef', commonRecipe, { categoryId: boulCategory })).passed).toBe(false);
  });
});
