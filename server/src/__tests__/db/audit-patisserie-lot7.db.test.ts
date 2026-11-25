/**
 * Audit production pâtissière 2026-11 — lot 7 (mig 679).
 *
 * C-19 : un four de 24 plaques par jour, une fiche qui prend 2 plaques par fournée.
 *        Un ordre de 10 fournées passe ; un second de 4 fournées sature le four :
 *        avertissement (défaut), puis refus avec la politique « Bloquer ».
 * C-28 : bon accepté, un article annulé : sa matière revient au magasin (lot, inventaire,
 *        sortie du plan diminuée, mouvement tracé) ; on ne rend pas plus que sorti ; refusé
 *        avant le prélèvement.
 * C-32 : avec la séparation des tâches, qui a remis le bon ne peut pas l'accepter ni y
 *        enregistrer un retour ; une autre personne le peut.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, cleanupFixtures, num, RUN, setComposition, type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Audit pâtisserie — lot 7 capacités et flux', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let policies: typeof import('../../services/policies.js');
  let fx: Fixtures;
  let other: string;
  let farine: string;
  let prodTarte: string;
  let prodPain: string;
  let four: string;
  const p = () => testPool();
  const day = '2031-03-14';

  async function product(tag: string, lines: { ingredientId: string; quantity: number }[]) {
    const id = (await p().query(
      `INSERT INTO products (name, slug, price, sale_type, sale_unit) VALUES ($1, $2, 10, 'jour', 'unit') RETURNING id`,
      [`L7 ${tag} ${RUN}`, `l7-${tag}-${RUN}`])).rows[0].id;
    fx.ids.products.push(id);
    const rec = (await p().query(
      `INSERT INTO recipes (name, is_base, product_id, yield_quantity, yield_unit, mode_cout, compo_par_piece)
       VALUES ($1, false, $2, 1, 'unit', 'compose', true) RETURNING id`, [`Fiche l7 ${tag} ${RUN}`, id])).rows[0].id;
    fx.ids.recipes.push(rec);
    await setComposition(rec, { ingredients: lines.map(l => ({ ...l, unit: 'kg' })) });
    return { id, rec };
  }
  async function plan(items: { productId: string; plannedQuantity: number }[], date = day) {
    const pl = await repos.productionRepository.create({ planDate: date, type: 'daily', createdBy: fx.userId, storeId: fx.storeId, items });
    fx.ids.plans.push(pl.id);
    return pl.id as string;
  }
  async function setPolicy(key: string, value: Record<string, unknown> | null) {
    const r = await policies.setPolicy(key, 'store', fx.storeId, value, fx.userId);
    if ('error' in r) throw new Error(r.error);
    policies.invalidatePolicies();
  }
  const stockOf = async (ing: string) =>
    num((await p().query(`SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [ing, fx.storeId])).rows[0]?.current_quantity);

  beforeAll(async () => {
    repos = await importRepositories();
    policies = await import('../../services/policies.js');
    fx = await createBaseFixtures();
    other = (await p().query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, store_id)
       VALUES ($1, 'x', 'Autre', 'Chef', 'admin', $2) RETURNING id`, [`autre-l7-${RUN}@test.local`, fx.storeId])).rows[0].id;
    farine = await createIngredient(fx, { name: 'Farine l7', unit: 'kg', unitCost: 5 });
    await createLot(fx, { ingredientId: farine, lotNumber: 'FL7', pesage: 100, expiresInDays: 60, unitCost: 5 });
    const tarte = await product('tarte', [{ ingredientId: farine, quantity: 0.5 }]);
    prodTarte = tarte.id;
    prodPain = (await product('pain', [{ ingredientId: farine, quantity: 0.2 }])).id;
    four = (await p().query(
      `INSERT INTO production_equipements (nom, type, cout_horaire, store_id, capacite_par_cycle, capacite_unite, cycles_par_jour)
       VALUES ($1, 'four', 0, $2, 12, 'plaque', 2) RETURNING id`, [`Four l7 ${RUN}`, fx.storeId])).rows[0].id;
    await p().query(`INSERT INTO recipe_equipements (recipe_id, equipement_id, charge_par_fournee) VALUES ($1, $2, 2)`, [tarte.rec, four]);
  }, 60_000);

  afterAll(async () => {
    await p().query(`DELETE FROM policy_values WHERE scope_type = 'store' AND scope_id = $1`, [fx?.storeId ?? '']).catch(() => undefined);
    policies?.invalidatePolicies();
    await p().query(`DELETE FROM production_material_returns WHERE plan_id = ANY($1)`, [fx?.ids.plans ?? []]).catch(() => undefined);
    await p().query(`DELETE FROM recipe_equipements WHERE equipement_id = $1`, [four]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    await p().query(`DELETE FROM production_equipements WHERE id = $1`, [four]).catch(() => undefined);
    await p().query(`DELETE FROM users WHERE id = $1`, [other]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('C-19 : la charge du jour se lit par équipement ; le dépassement est signalé à la confirmation', async () => {
    const { equipmentLoad } = await import('../../services/equipment-capacity.js');
    const a = await plan([{ productId: prodTarte, plannedQuantity: 10 }, { productId: prodPain, plannedQuantity: 30 }]);
    const r1 = await repos.productionRepository.confirm(a, fx.userId);
    expect(r1.warnings.some((w: string) => w.startsWith('Capacité'))).toBe(false);
    let load = (await equipmentLoad(p(), { date: day, storeId: fx.storeId })).find(e => e.equipementId === four)!;
    expect(load.capacity).toBe(24);
    expect(load.load).toBe(20);                     // 10 fournées × 2 plaques ; le pain n'occupe pas le four
    expect(load.lines.map(l => l.label)).toEqual([`L7 tarte ${RUN}`]);

    const b = await plan([{ productId: prodTarte, plannedQuantity: 4 }]);
    const r2 = await repos.productionRepository.confirm(b, fx.userId);
    const w = r2.warnings.find((x: string) => x.startsWith('Capacité'));
    expect(w).toContain(`Four l7 ${RUN} saturé : 28 plaque(s) demandés pour une capacité de 24`);
    load = (await equipmentLoad(p(), { date: day, storeId: fx.storeId, planId: b })).find(e => e.equipementId === four)!;
    expect(load.overloaded).toBe(true);
    expect(load.planLoad).toBe(8);
  });

  it('C-19 : politique « Bloquer » — la confirmation est refusée ; « Ne pas contrôler » — aucun message', async () => {
    await setPolicy('production.equipment_capacity', { mode: 'block' });
    const c = await plan([{ productId: prodTarte, plannedQuantity: 2 }]);
    await expect(repos.productionRepository.confirm(c, fx.userId)).rejects.toThrow(/Capacité des équipements dépassée/);
    const st = (await p().query(`SELECT status FROM production_plans WHERE id = $1`, [c])).rows[0].status;
    expect(st).toBe('draft');
    await setPolicy('production.equipment_capacity', { mode: 'off' });
    const r = await repos.productionRepository.confirm(c, fx.userId);
    expect(r.warnings.some((x: string) => x.startsWith('Capacité'))).toBe(false);
    await setPolicy('production.equipment_capacity', null);
  });

  let planR: string;
  let bonId: string;
  it('C-32 : avec la séparation des tâches, qui a remis le bon ne peut pas l\'accepter', async () => {
    await setPolicy('production.segregation_of_duties', { enabled: true });
    planR = await plan([{ productId: prodTarte, plannedQuantity: 10 }, { productId: prodPain, plannedQuantity: 10 }], '2031-03-20');
    await repos.productionRepository.confirm(planR, fx.userId);
    bonId = (await repos.bonSortieRepository.findByPlan(planR))[0].id;
    // Retour refusé avant le prélèvement : rien n'est sorti.
    const early = (await repos.bonSortieRepository.findByPlan(planR))[0].lines[0];
    await expect(repos.bonSortieRepository.returnMaterial(bonId, [{ ligneId: early.id, lotId: early.ingredient_lot_id, quantity: 1 }], 'essai', other))
      .rejects.toThrow(/pas encore été prélevé/);
    await repos.bonSortieRepository.markAsPreparation(bonId, fx.userId);
    const fresh = (await repos.bonSortieRepository.findByPlan(planR))[0];
    await repos.bonSortieRepository.weighLignes(bonId, fx.userId, fresh.lines.map((l: Record<string, unknown>) => (
      { ligneId: l.id as string, actualQuantity: num(l.allocated_quantity), source: 'manual' as const })));
    await repos.bonSortieRepository.markAsReady(bonId, fx.userId);
    await expect(repos.bonSortieRepository.acceptReception(bonId, fx.userId)).rejects.toThrow(/Séparation des tâches/);
    const accepted = await repos.bonSortieRepository.acceptReception(bonId, other);
    expect(accepted.status).toBe('cloture');
  });

  it('C-28 : la matière d\'un article annulé revient au magasin ; la sortie du plan diminue d\'autant', async () => {
    const items = (await p().query(`SELECT id, product_id FROM production_plan_items WHERE plan_id = $1`, [planR])).rows;
    const tarteItem = items.find(i => i.product_id === prodTarte)!.id;
    const painItem = items.find(i => i.product_id === prodPain)!.id;
    await repos.productionRepository.cancelItems(planR, [painItem], 'Commande annulée');
    const before = await stockOf(farine);
    const { lines } = await repos.bonSortieRepository.returnable(bonId);
    expect(lines).toHaveLength(1);
    expect(lines[0].returnable).toBeCloseTo(7, 3);   // 10 × 0,5 + 10 × 0,2
    const ret = { ligneId: lines[0].ligne_id, lotId: lines[0].ingredient_lot_id, quantity: 2 };

    // Séparation active : qui a préparé le bon n'enregistre pas le retour.
    await expect(repos.bonSortieRepository.returnMaterial(bonId, [ret], 'Pain annulé', fx.userId)).rejects.toThrow(/Séparation des tâches/);
    // Pas plus que ce qui est sorti.
    await expect(repos.bonSortieRepository.returnMaterial(bonId, [{ ...ret, quantity: 9 }], 'Trop', other)).rejects.toThrow(/supérieur à ce qui reste sorti/);

    const r = await repos.bonSortieRepository.returnMaterial(bonId, [ret], 'Pain annulé', other);
    expect(r.returned[0].quantity).toBe(2);
    expect(await stockOf(farine)).toBeCloseTo(before + 2, 3);
    const usage = new Map((await p().query(
      `SELECT plan_item_id, SUM(quantity_used)::float8 q FROM production_lot_usage WHERE production_plan_id = $1 GROUP BY 1`, [planR])).rows
      .map(u => [u.plan_item_id, Number(u.q)]));
    expect(usage.get(painItem) ?? 0).toBeCloseTo(0, 3);   // la part du pain annulé, rendue en premier
    expect(usage.get(tarteItem)).toBeCloseTo(5, 3);
    const mv = (await p().query(
      `SELECT quantity_change::float8 q, plan_item_id FROM inventory_transactions WHERE production_plan_id = $1 AND type = 'production_return'`, [planR])).rows;
    expect(mv).toEqual([{ q: 2, plan_item_id: painItem }]);
    const after = await repos.bonSortieRepository.returnable(bonId);
    expect(after.lines[0].returnable).toBeCloseTo(5, 3);
    expect(after.history).toHaveLength(1);
    await setPolicy('production.segregation_of_duties', null);
  });
});
