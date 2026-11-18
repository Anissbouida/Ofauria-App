/**
 * M9 — sous-traitance (mig 584) : sous-traitant + façon → bon d'envoi numéroté (besoins figés)
 * → réception (statut « reçu ») → façon = prix unitaire × quantité reçue dans le coût de revient.
 * La réception est refusée tant que les composants ne sont pas envoyés.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hasTestDb, testPool, closeTestPool, importRepositories, createBaseFixtures, RUN, type Fixtures } from './helpers.js';

describe.skipIf(!hasTestDb)('Sous-traitance de production (M9)', () => {
  let fx: Fixtures;
  let repo: typeof import('../../repositories/subcontracting.repository.js')['subcontractingRepository'];
  let cout: typeof import('../../repositories/production-cout.repository.js')['productionCoutRepository'];
  const ids: Record<string, string> = {};
  const p = () => testPool();

  beforeAll(async () => {
    await importRepositories();
    repo = (await import('../../repositories/subcontracting.repository.js')).subcontractingRepository;
    cout = (await import('../../repositories/production-cout.repository.js')).productionCoutRepository;
    fx = await createBaseFixtures();
    ids.type = (await p().query(
      `INSERT INTO production_order_types (code, label, requires_bon_sortie, requires_weighing, consumption_mode, is_subcontracting)
       VALUES ($1, 'Sous-traitance test', false, false, 'a_la_declaration', true) RETURNING id`, [`ST_${RUN}`.slice(0, 30)])).rows[0].id;
    ids.supplier = (await p().query(`INSERT INTO suppliers (name) VALUES ($1) RETURNING id`, [`Façonnier ${RUN}`])).rows[0].id;
    ids.ingredient = (await p().query(`INSERT INTO ingredients (name, unit, unit_cost) VALUES ($1, 'kg', 10) RETURNING id`, [`Tôle ${RUN}`])).rows[0].id;
    ids.plan = (await p().query(
      `INSERT INTO production_plans (plan_date, type, created_by, order_type_id, status, store_id)
       VALUES (CURRENT_DATE, 'daily', $1, $2, 'confirmed', $3) RETURNING id`, [fx.userId, ids.type, fx.storeId])).rows[0].id;
    ids.item = (await p().query(
      `INSERT INTO production_plan_items (plan_id, planned_quantity) VALUES ($1, 40) RETURNING id`, [ids.plan])).rows[0].id;
    await p().query(`INSERT INTO production_ingredient_needs (plan_id, ingredient_id, needed_quantity, available_quantity) VALUES ($1, $2, 12.5, 100)`,
      [ids.plan, ids.ingredient]);
  }, 60_000);

  afterAll(async () => {
    const run = async (sql: string, params: unknown[]) => { try { await p().query(sql, params); } catch { /* best effort */ } };
    await run(`DELETE FROM production_cout_reel WHERE plan_id = $1`, [ids.plan]);
    await run(`DELETE FROM production_plans WHERE id = $1`, [ids.plan]);
    await run(`DELETE FROM ingredients WHERE id = $1`, [ids.ingredient]);
    await run(`DELETE FROM suppliers WHERE id = $1`, [ids.supplier]);
    await run(`DELETE FROM production_order_types WHERE id = $1`, [ids.type]);
    await run(`DELETE FROM users WHERE id = $1`, [fx.userId]);
    await run(`DELETE FROM stores WHERE id = $1`, [fx.storeId]);
    await closeTestPool();
  }, 60_000);

  it('envoi, garde de réception, réception et coût de façon', async () => {
    expect(await repo.receptionBlocker(ids.plan)).toMatch(/sous-traitant/);
    const s = await repo.setup(ids.plan, { supplierId: ids.supplier, unitFee: 2.5 });
    expect(s).toMatchObject({ status: 'to_ship', unitFee: 2.5, subcontractorId: ids.supplier });
    expect(await repo.receptionBlocker(ids.plan)).toMatch(/envoyez/);

    const sh = await repo.ship(ids.plan, fx.userId, 'Palette 1');
    expect(sh.numero).toMatch(/^BES-\d{4}-\d{4}$/);
    await expect(repo.ship(ids.plan, fx.userId)).rejects.toThrow(/déjà envoyés/);
    const after = await repo.get(ids.plan);
    expect(after!.status).toBe('shipped');
    expect(after!.shipments[0].lines).toEqual([{ ingredient_id: ids.ingredient, label: `Tôle ${RUN}`, quantity: 12.5, unit: 'kg' }]);
    expect(await repo.receptionBlocker(ids.plan)).toBeNull();

    // Réception : la déclaration (simulée ici) renseigne la quantité reçue.
    await p().query(`UPDATE production_plan_items SET actual_quantity = 38, status = 'produced' WHERE id = $1`, [ids.item]);
    await repo.markReceived(ids.plan);
    const recv = await repo.get(ids.plan);
    expect(recv).toMatchObject({ status: 'received', receivedQuantity: 38, fee: { amount: 95 } });

    const c = await cout.computePlanCost(ids.plan);
    expect(c.coutSousTraitance).toBe(95);
    const saved = await cout.calculateAndSave(ids.plan, fx.userId);
    expect(Number(saved.cout_sous_traitance)).toBe(95);
    expect(Number(saved.cout_total)).toBeCloseTo(c.coutTotal, 2);
  });

  it('type non sous-traité : rien ne change', async () => {
    const def = (await p().query(`SELECT id FROM production_order_types WHERE is_default`)).rows[0].id;
    const plan = (await p().query(
      `INSERT INTO production_plans (plan_date, type, created_by, order_type_id, status) VALUES (CURRENT_DATE, 'daily', $1, $2, 'draft') RETURNING id`,
      [fx.userId, def])).rows[0].id;
    try {
      expect(await repo.get(plan)).toBeNull();
      expect(await repo.receptionBlocker(plan)).toBeNull();
      expect((await repo.feeCost(plan)).amount).toBe(0);
    } finally {
      await p().query(`DELETE FROM production_plans WHERE id = $1`, [plan]);
    }
  });
});
