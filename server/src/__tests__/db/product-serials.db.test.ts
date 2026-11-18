/**
 * M9 — numéros de série (mig 585) : à la déclaration, un numéro par pièce pour les lots
 * d'un article suivi par série (saisis puis générés), aucun pour un article suivi par lot ;
 * recherche d'un numéro → article, lot, ordre.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Numéros de série en fabrication (M9)', () => {
  let fx: Fixtures;
  let repo: typeof import('../../repositories/product-serial.repository.js')['productSerialRepository'];
  const ids: Record<string, string> = {};
  const p = () => testPool();

  beforeAll(async () => {
    await importRepositories();
    repo = (await import('../../repositories/product-serial.repository.js')).productSerialRepository;
    fx = await createBaseFixtures();
    ids.serialProduct = (await p().query(
      `INSERT INTO products (name, slug, price, tracking_mode) VALUES ($1, $2, 100, 'serial') RETURNING id`,
      [`Chaise ${RUN}`, `chaise-${RUN}`.toLowerCase()])).rows[0].id;
    ids.lotProduct = (await p().query(
      `INSERT INTO products (name, slug, price) VALUES ($1, $2, 10) RETURNING id`, [`Vis ${RUN}`, `vis-${RUN}`.toLowerCase()])).rows[0].id;
    const def = (await p().query(`SELECT id FROM production_order_types WHERE is_default`)).rows[0].id;
    ids.plan = (await p().query(
      `INSERT INTO production_plans (plan_date, type, created_by, order_type_id, status, store_id)
       VALUES (CURRENT_DATE, 'daily', $1, $2, 'in_progress', $3) RETURNING id`, [fx.userId, def, fx.storeId])).rows[0].id;
    ids.item = (await p().query(`INSERT INTO production_plan_items (plan_id, product_id, planned_quantity) VALUES ($1, $2, 3) RETURNING id`, [ids.plan, ids.serialProduct])).rows[0].id;
    ids.item2 = (await p().query(`INSERT INTO production_plan_items (plan_id, product_id, planned_quantity) VALUES ($1, $2, 50) RETURNING id`, [ids.plan, ids.lotProduct])).rows[0].id;
    for (const [prod, item, qty, lot] of [[ids.serialProduct, ids.item, 3, `S${RUN}`], [ids.lotProduct, ids.item2, 50, `V${RUN}`]] as const) {
      await p().query(
        `INSERT INTO product_lots (product_id, production_plan_id, plan_item_id, store_id, lot_number, quantity_total, backroom_qty)
         VALUES ($1, $2, $3, $4, $5, $6, $6)`, [prod, ids.plan, item, fx.storeId, lot, qty]);
    }
  }, 60_000);

  afterAll(async () => {
    const run = async (sql: string, params: unknown[]) => { try { await p().query(sql, params); } catch { /* best effort */ } };
    await run(`DELETE FROM product_serials WHERE plan_id = $1`, [ids.plan]);
    await run(`DELETE FROM product_lots WHERE production_plan_id = $1`, [ids.plan]);
    await run(`DELETE FROM production_plans WHERE id = $1`, [ids.plan]);
    await run(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [[ids.serialProduct, ids.lotProduct]]);
    await run(`DELETE FROM users WHERE id = $1`, [fx.userId]);
    await run(`DELETE FROM stores WHERE id = $1`, [fx.storeId]);
    await closeTestPool();
  }, 60_000);

  it('un numéro par pièce pour l\'article suivi par série, aucun pour l\'article suivi par lot', async () => {
    const r = await repo.assignForPlan(ids.plan, [{ planItemId: ids.item, serials: ['CH-0042'] }], fx.userId);
    expect(r.created).toBe(3);
    const list = await repo.listForPlan(ids.plan);
    expect(list.map(s => s.serial_number)).toEqual(['CH-0042', `S${RUN}-0001`, `S${RUN}-0002`]);
    // Relancer ne recrée rien.
    expect((await repo.assignForPlan(ids.plan, [], fx.userId)).created).toBe(0);
    const found = await repo.lookup('CH-0042');
    expect(found[0]).toMatchObject({ product_name: `Chaise ${RUN}`, lot_number: `S${RUN}`, plan_id: ids.plan });
  });
});
