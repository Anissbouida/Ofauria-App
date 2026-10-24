/**
 * Parcours de production de bout en bout, sur base migree (TEST_DATABASE_URL) :
 *
 *   plan brouillon -> confirm (besoins) -> BSI genere (FEFO, lots hors DLC exclus)
 *   -> prelevement (stock matiere decremente UNE fois) -> verifie -> cloture
 *   -> start -> produceItems -> stock produit, LOT PRODUIT FINI (DLC jour meme),
 *   pas de double deduction, plan auto-complete.
 *
 * Puis la derogation DLC (mig 339) : sans motif les lots perimes sont ecartes
 * et remontes ; avec motif ils sont alloues et traces.
 *
 * Les repositories ouvrent leurs propres connexions : les fixtures sont
 * COMMITEES puis nettoyees en afterAll (base jetable).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, createProductWithRecipe, cleanupFixtures,
  num, type Fixtures,
} from './helpers.js';

describe.skipIf(!hasTestDb)('Production — BSI -> produceItems -> lot produit fini', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let fx: Fixtures;
  let farineId: string; let lotOkId: string; let lotExpiredId: string;
  let productId: string;
  let planId: string; let planItemId: string; let bonId: string;
  let inventoryBefore: number;

  beforeAll(async () => {
    repos = await importRepositories();
    fx = await createBaseFixtures();
    farineId = await createIngredient(fx, { name: 'Farine', unit: 'kg', unitCost: 10, allergens: ['gluten'] });
    // Lot sain : 50 kg au pesage, DLC dans 30 jours. Lot perime : 20 kg, DLC hier (statut encore 'active').
    lotOkId = await createLot(fx, { ingredientId: farineId, lotNumber: 'OK', pesage: 50, expiresInDays: 30, unitCost: 10 });
    lotExpiredId = await createLot(fx, { ingredientId: farineId, lotNumber: 'PERIME', pesage: 20, expiresInDays: -1, unitCost: 9 });
    const pr = await createProductWithRecipe(fx, {
      name: 'Baguette', price: 3, shelfLifeDays: null,     // pas de DLV parametree -> lot « jour meme »
      ingredients: [{ ingredientId: farineId, quantity: 0.5, unit: 'kg' }],
    });
    productId = pr.productId;
    const inv = await testPool().query(`SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [farineId, fx.storeId]);
    inventoryBefore = num(inv.rows[0]?.current_quantity);
  }, 60_000);

  afterAll(async () => {
    if (fx) await cleanupFixtures(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('le trigger mig 114 a synchronise l\'inventaire depuis les lots', () => {
    expect(inventoryBefore).toBeCloseTo(70, 3); // 50 + 20
  });

  it('plan brouillon -> confirm : besoins calcules depuis la recette', async () => {
    const plan = await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId, plannedQuantity: 10 }],
    });
    planId = plan.id; fx.ids.plans.push(planId);
    const { warnings } = await repos.productionRepository.confirm(planId, fx.userId);
    expect(warnings).toEqual([]);
    const needs = await testPool().query(`SELECT needed_quantity FROM production_ingredient_needs WHERE plan_id = $1 AND ingredient_id = $2`, [planId, farineId]);
    expect(num(needs.rows[0].needed_quantity)).toBeCloseTo(5, 3); // 10 x 0,5 kg
    const items = await testPool().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [planId]);
    planItemId = items.rows[0].id;
  });

  it('BSI genere par confirm : FEFO sur le lot sain, le lot hors DLC est ECARTE (mig 339)', async () => {
    // confirm() genere le BSI lui-meme (production.repository.ts) : on le relit.
    const bons = await repos.bonSortieRepository.findByPlan(planId);
    expect(bons).toHaveLength(1);
    const bon = bons[0];
    bonId = bon.id;
    expect(bon.status).toBe('genere');
    const farineLines = bon.lines.filter((l: Record<string, unknown>) => l.ingredient_id === farineId);
    expect(farineLines).toHaveLength(1);
    expect(farineLines[0].ingredient_lot_id).toBe(lotOkId);
    expect(num(farineLines[0].allocated_quantity)).toBeCloseTo(5, 3);
    expect(farineLines[0].derogation_dlc).toBe(false);
    expect(bon.derogation_dlc_motif ?? null).toBeNull();
    const plan = await testPool().query(`SELECT status FROM production_plans WHERE id = $1`, [planId]);
    expect(plan.rows[0].status).toBe('awaiting_ingredients');
  });

  it('prelevement -> verifie -> cloture : la matiere sort UNE fois, du bon lot', async () => {
    await repos.bonSortieRepository.startPrelevement(bonId, fx.userId);
    await repos.bonSortieRepository.verify(bonId, fx.userId);
    const closed = await repos.bonSortieRepository.close(bonId, fx.userId);
    expect(closed.status).toBe('cloture');
    const lot = await testPool().query(`SELECT pesage_quantity FROM ingredient_lots WHERE id = $1`, [lotOkId]);
    expect(num(lot.rows[0].pesage_quantity)).toBeCloseTo(45, 3);
    const inv = await testPool().query(`SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [farineId, fx.storeId]);
    expect(num(inv.rows[0].current_quantity)).toBeCloseTo(inventoryBefore - 5, 3);
  });

  it('start refuse un double demarrage (verrou mig 338) puis produceItems cree stock + lot et auto-complete', async () => {
    await repos.productionRepository.start(planId);
    await expect(repos.productionRepository.start(planId)).rejects.toThrow(/in_progress/);

    const res = await repos.productionRepository.produceItems(planId, [{ planItemId, actualQuantity: 10 }], fx.userId, fx.storeId);
    expect(res.autoCompleted).toBe(true);

    const stock = await testPool().query(`SELECT stock_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`, [productId, fx.storeId]);
    expect(num(stock.rows[0].stock_quantity)).toBeCloseTo(10, 3);

    // Lot produit fini SYSTEMATIQUE : sans shelf_life_days, DLC = jour meme = produced + 1 jour
    // (convention <=). La date est calculee dans le fuseau METIER (Africa/Casablanca), pas
    // celui du serveur Postgres : on compare dans ce fuseau.
    const lots = await testPool().query(
      `SELECT quantity_total, backroom_qty, expires_at::text AS expires_at,
              ((produced_at AT TIME ZONE 'Africa/Casablanca')::date + 1)::text AS expected
       FROM product_lots WHERE production_plan_id = $1 AND product_id = $2`, [planId, productId]
    );
    expect(lots.rows).toHaveLength(1);
    expect(num(lots.rows[0].quantity_total)).toBeCloseTo(10, 3);
    expect(num(lots.rows[0].backroom_qty)).toBeCloseTo(10, 3);
    expect(lots.rows[0].expires_at).toBe(lots.rows[0].expected);

    // Pas de double deduction : le BSI avait deja sorti la matiere.
    const lot = await testPool().query(`SELECT pesage_quantity FROM ingredient_lots WHERE id = $1`, [lotOkId]);
    expect(num(lot.rows[0].pesage_quantity)).toBeCloseTo(45, 3);
    const inv = await testPool().query(`SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [farineId, fx.storeId]);
    expect(num(inv.rows[0].current_quantity)).toBeCloseTo(inventoryBefore - 5, 3);

    const plan = await testPool().query(`SELECT status, completion_type FROM production_plans WHERE id = $1`, [planId]);
    expect(plan.rows[0].status).toBe('completed');
    expect(plan.rows[0].completion_type).toBe('complete');
  });

  it('complete refuse un plan deja termine (verrou mig 338)', async () => {
    await expect(repos.productionRepository.complete(planId, [], fx.userId, fx.storeId)).rejects.toThrow(/completed/);
  });

  it('derogation DLC : avec motif, le lot perime est alloue et la decision tracee', async () => {
    // Nouveau plan de 100 : besoin 50 kg > 45 restants sur le lot sain.
    const plan2 = await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId, plannedQuantity: 100 }],
    });
    fx.ids.plans.push(plan2.id);
    await repos.productionRepository.confirm(plan2.id, fx.userId);

    // regenerate = annule le BSI du confirm et en genere un neuf : on recupere
    // ainsi le retour de generate (lines + expired_lots_skipped).
    const sans = await repos.bonSortieRepository.regenerate(plan2.id, fx.storeId, fx.userId);
    const lignesSans = sans.lines.filter((l: Record<string, unknown>) => l.ingredient_id === farineId);
    expect(lignesSans.some((l: Record<string, unknown>) => l.ingredient_lot_id === lotExpiredId)).toBe(false);
    expect(lignesSans.some((l: Record<string, unknown>) => l.source_location === 'RUPTURE')).toBe(true);
    expect(sans.expired_lots_skipped).toHaveLength(1);

    const avec = await repos.bonSortieRepository.regenerate(plan2.id, fx.storeId, fx.userId, {
      derogationDlc: { motif: 'Controle organoleptique OK, farine utilisee en cuisson' },
    });
    const lignesAvec = avec.lines.filter((l: Record<string, unknown>) => l.ingredient_id === farineId);
    const surPerime = lignesAvec.find((l: Record<string, unknown>) => l.ingredient_lot_id === lotExpiredId);
    expect(surPerime).toBeDefined();
    expect(surPerime!.derogation_dlc).toBe(true);
    expect(avec.expired_lots_skipped).toEqual([]);
    const header = await testPool().query(`SELECT derogation_dlc_motif, derogation_dlc_by, derogation_dlc_at FROM production_bons_sortie WHERE id = $1`, [avec.id]);
    expect(header.rows[0].derogation_dlc_motif).toMatch(/organoleptique/);
    expect(header.rows[0].derogation_dlc_by).toBe(fx.userId);
    expect(header.rows[0].derogation_dlc_at).not.toBeNull();
  });
});
