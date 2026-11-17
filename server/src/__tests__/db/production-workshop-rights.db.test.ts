/**
 * M2-06 — droits par atelier : agir sur un ordre exige d'appartenir à son atelier
 * (production_workshop_members, mig 511), sauf permission production.all_workshops
 * (admin, gérant par défaut). La lecture reste ouverte.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createProductWithRecipe, cleanupFixtures, RUN, type Fixtures,
} from './helpers.js';

type Res = { statusCode: number; body: any; status(c: number): Res; json(b: unknown): Res };
const fakeRes = (): Res => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

describe.skipIf(!hasTestDb)('Droits par atelier sur les ordres (M2-06)', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let ctrl: typeof import('../../controllers/production.controller.js')['productionController'];
  let fx: Fixtures; let planId: string;
  const users: Record<string, string | undefined> = {};
  const createdUsers: string[] = [];
  const p = () => testPool();
  const call = async (action: 'updateHeader' | 'getById', role: string) => {
    const res = fakeRes();
    await (ctrl[action] as any)({ params: { id: planId }, body: { priority: 2 }, query: {},
      user: { userId: users[role]!, role, baseRoles: [role], storeId: fx.storeId } }, res);
    return res;
  };

  beforeAll(async () => {
    repos = await importRepositories();
    ctrl = (await import('../../controllers/production.controller.js')).productionController;
    fx = await createBaseFixtures();
    for (const role of ['baker', 'pastry_chef', 'manager']) {
      users[role] = (await p().query(
        `INSERT INTO users (email, password_hash, first_name, last_name, role, store_id)
         VALUES ($1, 'x', 'Test', $2, $2, $3) RETURNING id`, [`${role}-m206-${RUN}@test.local`, role, fx.storeId])).rows[0].id;
      createdUsers.push(users[role]!);
    }
    const farine = await createIngredient(fx, { name: 'Farine M206', unit: 'kg', unitCost: 10 });
    const productId = (await createProductWithRecipe(fx, { name: 'Tarte M206', price: 30, shelfLifeDays: null,
      ingredients: [{ ingredientId: farine, quantity: 0.2, unit: 'kg' }] })).productId;
    planId = (await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      targetRole: 'pastry_chef', items: [{ productId, plannedQuantity: 3 }],
    })).id;
    fx.ids.plans.push(planId);
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx);
    await p().query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUsers]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('un chef d\'un autre atelier ne peut pas agir sur l\'ordre', async () => {
    const res = await call('updateHeader', 'baker');
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('WORKSHOP_FORBIDDEN');
  });

  it('il peut le consulter', async () => {
    expect((await call('getById', 'baker')).statusCode).toBe(200);
  });

  it('le chef de l\'atelier agit ; le gérant aussi (tous ateliers)', async () => {
    expect((await call('updateHeader', 'pastry_chef')).statusCode).toBe(200);
    expect((await call('updateHeader', 'manager')).statusCode).toBe(200);
    expect((await p().query(`SELECT priority FROM production_plans WHERE id = $1`, [planId])).rows[0].priority).toBe(2);
  });
});
