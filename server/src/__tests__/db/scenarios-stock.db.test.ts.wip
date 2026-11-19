/**
 * Scenarios STOCK — parcours realistes magasinier / gerant sur base migree.
 *
 * Couvre, de bout en bout, le domaine « gestion de stock » :
 *   1. Lots matiere : reception (trigger inventaire mig 114), zones economat/pesage,
 *      transfert economat -> pesage par CONTENANT ENTIER (openToPesage).
 *   2. BSI : generation FEFO (lot perime ecarte), part economat eclatee en lignes
 *      FEFO par lot (plusieurs fonds de sac), pesee multi-sources jusqu'a
 *      l'acceptation chef (stock matiere sort UNE fois), rupture quand le stock manque.
 *   3. Ingredient non stocke (eau) exclu des besoins / du BSI.
 *   4. Valorisation des pertes au cout MATIERES (jamais 0, jamais le prix de vente) :
 *      produit fini DLC, ingredient casse/DLC.
 *   5. Reconciliation vitrine <-> lots (dry-run + apply).
 *   6. Reconciliation semi-finis <-> lots (dry-run + apply).
 *   7. Auto-expire des lots produits : DLC (tout le lot) vs DLV seule (vitrine only).
 *
 * Les repositories ouvrent leurs propres connexions : les fixtures sont COMMITEES
 * puis nettoyees en afterAll (base jetable). Tout est scope par store/ingredient/
 * recette + suffixe RUN pour tourner en parallele d'autres suites sans collision.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, createProductWithRecipe, cleanupFixtures,
  num, RUN, type Fixtures,
} from './helpers.js';

type Row = Record<string, any>;

describe.skipIf(!hasTestDb)('Scenarios STOCK', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let productLotRepository: typeof import('../../repositories/product-lot.repository.js').productLotRepository;
  let ingredientLotRepository: typeof import('../../repositories/ingredient-lot.repository.js').ingredientLotRepository;
  let stockFrigoRepository: typeof import('../../repositories/stock-frigo.repository.js').stockFrigoRepository;
  let productCostHelper: typeof import('../../repositories/product-cost.helper.js');
  let sacTypeId: string;
  // Fixture UNIQUE pour tout le fichier : createBaseFixtures derive l'email du user
  // de RUN (constant par fichier), donc un 2e appel violerait users.email UNIQUE.
  // Un seul store/user partage, chaque bloc cree ses propres ingredients/produits.
  let fx: Fixtures;

  beforeAll(async () => {
    repos = await importRepositories();
    productLotRepository = (await import('../../repositories/product-lot.repository.js')).productLotRepository;
    ingredientLotRepository = (await import('../../repositories/ingredient-lot.repository.js')).ingredientLotRepository;
    stockFrigoRepository = (await import('../../repositories/stock-frigo.repository.js')).stockFrigoRepository;
    productCostHelper = await import('../../repositories/product-cost.helper.js');
    const sac = await testPool().query(
      `SELECT id FROM ref_entries WHERE table_id = 'container_types' AND code = 'sac' LIMIT 1`
    );
    sacTypeId = sac.rows[0].id;
    fx = await createBaseFixtures();
  }, 60_000);

  afterAll(async () => {
    if (fx) await deepClean(fx);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  // Nettoyage cible des tables non couvertes par cleanupFixtures (FK + residus),
  // avant le cleanup generique. Best-effort : base jetable.
  async function deepClean(fx: Fixtures) {
    const p = testPool();
    const run = async (sql: string, params: unknown[]) => { try { await p.query(sql, params); } catch { /* best effort */ } };
    await run(`DELETE FROM ingredient_stock_zone_transfers WHERE store_id = $1`, [fx.storeId]);
    await run(`DELETE FROM production_lot_usage WHERE ingredient_id = ANY($1)`, [fx.ids.ingredients]);
    await run(`DELETE FROM production_bons_sortie_lignes WHERE bon_id IN (SELECT id FROM production_bons_sortie WHERE store_id = $1)`, [fx.storeId]);
    await run(`DELETE FROM production_bons_sortie WHERE store_id = $1`, [fx.storeId]);
    await run(`DELETE FROM product_lot_movements WHERE store_id = $1`, [fx.storeId]);
    await run(`DELETE FROM product_losses WHERE store_id = $1`, [fx.storeId]);
    await run(`DELETE FROM semi_finished_lot_usage WHERE semi_finished_lot_id IN (SELECT id FROM semi_finished_lots WHERE store_id = $1)`, [fx.storeId]);
    await run(`DELETE FROM semi_finished_lots WHERE store_id = $1`, [fx.storeId]);
    await run(`DELETE FROM semi_finished_transactions WHERE store_id = $1`, [fx.storeId]);
    await run(`DELETE FROM semi_finished_stock WHERE store_id = $1`, [fx.storeId]);
    await run(`DELETE FROM stock_frigo_transactions WHERE stock_frigo_id IN (SELECT id FROM stock_semifini_frigo WHERE store_id = $1)`, [fx.storeId]);
    await run(`DELETE FROM stock_semifini_frigo WHERE store_id = $1`, [fx.storeId]);
    await cleanupFixtures(fx);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 1. Lots matiere : reception, trigger inventaire, zones, transfert par contenant
  // ══════════════════════════════════════════════════════════════════════════
  describe('Lots matiere — reception, zones economat/pesage, transfert par contenant', () => {
    let farineId: string; let lotId: string;
    let invAfterReception: number;

    beforeAll(async () => {
      farineId = await createIngredient(fx, { name: 'Farine T55 stk', unit: 'kg', unitCost: 10 });
      // Ingredient defini par contenant : sac de 1 kg (regle contenant entier).
      await testPool().query(
        `UPDATE ingredients SET container_size = 1, container_type_id = $2 WHERE id = $1`,
        [farineId, sacTypeId]
      );
      // Reception : 5 kg scelles en economat (5 sacs), rien d'ouvert au pesage.
      lotId = await createLot(fx, {
        ingredientId: farineId, lotNumber: 'RECEP', pesage: 0, economat: 5, expiresInDays: 60, unitCost: 10,
      });
      const inv = await testPool().query(
        `SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [farineId, fx.storeId]
      );
      invAfterReception = num(inv.rows[0]?.current_quantity);
    }, 60_000);

    it('reception : le trigger mig 114 synchronise inventory = economat + pesage (5 kg)', () => {
      expect(invAfterReception).toBeCloseTo(5, 3);
    });

    it('zone pesage vide a la reception (aucun contenant encore ouvert)', async () => {
      const stock = await ingredientLotRepository.findPesageStock(fx.storeId);
      const mine = (stock as Row[]).find((r) => r.ingredient_id === farineId);
      expect(mine).toBeUndefined();
    });

    it('transfert economat -> pesage : demande 2,3 kg -> 3 sacs entiers ouverts (regle contenant)', async () => {
      const res = await ingredientLotRepository.openToPesage(lotId, 2.3, fx.userId, { reason: 'Mise au pesage du matin' });
      // Arrondi au contenant superieur : 2,3 kg -> 3 sacs de 1 kg = 3 kg.
      expect(num(res.opened_quantity)).toBeCloseTo(3, 3);
      expect(res.container_count).toBe(3);

      const lot = await testPool().query(
        `SELECT economat_quantity, pesage_quantity, first_opened_at FROM ingredient_lots WHERE id = $1`, [lotId]
      );
      expect(num(lot.rows[0].economat_quantity)).toBeCloseTo(2, 3);  // 5 - 3
      expect(num(lot.rows[0].pesage_quantity)).toBeCloseTo(3, 3);
      expect(lot.rows[0].first_opened_at).not.toBeNull();
    });

    it('un transfert de zone ne change PAS le stock total (inventory reste 5 kg)', async () => {
      const inv = await testPool().query(
        `SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [farineId, fx.storeId]
      );
      expect(num(inv.rows[0].current_quantity)).toBeCloseTo(5, 3);
    });

    it('le transfert est trace (ingredient_stock_zone_transfers ECONOMAT -> PESAGE, 3 contenants)', async () => {
      const t = await testPool().query(
        `SELECT from_zone, to_zone, quantity, container_count, container_type_id
           FROM ingredient_stock_zone_transfers WHERE ingredient_lot_id = $1`, [lotId]
      );
      expect(t.rows).toHaveLength(1);
      expect(t.rows[0].from_zone).toBe('ECONOMAT');
      expect(t.rows[0].to_zone).toBe('PESAGE');
      expect(num(t.rows[0].quantity)).toBeCloseTo(3, 3);
      expect(t.rows[0].container_count).toBe(3);
      expect(t.rows[0].container_type_id).toBe(sacTypeId);
    });

    it('la zone pesage affiche desormais le lot ouvert (3 kg)', async () => {
      const stock = await ingredientLotRepository.findPesageStock(fx.storeId);
      const mine = (stock as Row[]).find((r) => r.ingredient_id === farineId);
      expect(mine).toBeDefined();
      expect(num(mine!.total_pesage)).toBeCloseTo(3, 3);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. BSI — FEFO (lot perime ecarte), pesee multi-sources, acceptation chef
  // ══════════════════════════════════════════════════════════════════════════
  describe('BSI — FEFO multi-sources (pesage + economat), lot perime ecarte', () => {
    let beurreId: string;
    let lotPesageId: string; let lotEcoAId: string; let lotEcoBId: string; let lotPerimeId: string;
    let productId: string; let planId: string; let bonId: string;
    let invBefore: number;

    beforeAll(async () => {
      beurreId = await createIngredient(fx, { name: 'Beurre AOP bsi', unit: 'kg', unitCost: 60 });
      // Stock non perime : 0,15 kg deja au pesage + 2 fonds de sac economat (0,2 + 0,2).
      lotPesageId = await createLot(fx, { ingredientId: beurreId, lotNumber: 'PES', pesage: 0.15, economat: 0, expiresInDays: 20, unitCost: 60 });
      lotEcoAId = await createLot(fx, { ingredientId: beurreId, lotNumber: 'ECOA', pesage: 0, economat: 0.2, expiresInDays: 25, unitCost: 60 });
      lotEcoBId = await createLot(fx, { ingredientId: beurreId, lotNumber: 'ECOB', pesage: 0, economat: 0.2, expiresInDays: 30, unitCost: 60 });
      // Lot perime (DLC hier, statut encore 'active') : doit etre ECARTE du FEFO.
      lotPerimeId = await createLot(fx, { ingredientId: beurreId, lotNumber: 'PERIME', pesage: 0.5, economat: 0, expiresInDays: -1, unitCost: 55 });
      const pr = await createProductWithRecipe(fx, {
        name: 'Croissant bsi', price: 2, shelfLifeDays: null,
        ingredients: [{ ingredientId: beurreId, quantity: 0.5, unit: 'kg' }],
      });
      productId = pr.productId;
      const inv = await testPool().query(
        `SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [beurreId, fx.storeId]
      );
      invBefore = num(inv.rows[0]?.current_quantity);
    }, 60_000);

    it('reception : inventory = somme de TOUS les lots actifs (perime compris) = 1,05 kg', () => {
      // 0,15 + 0,2 + 0,2 + 0,5. Le perime compte au stock tant qu'il n'est pas sorti,
      // mais ne sera pas ALLOUABLE par le BSI.
      expect(invBefore).toBeCloseTo(1.05, 3);
    });

    it('confirm auto-genere le BSI : pesage servi d abord, puis economat FEFO par lot, perime ecarte', async () => {
      const plan = await repos.productionRepository.create({
        planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
        items: [{ productId, plannedQuantity: 1 }],
      });
      planId = plan.id; fx.ids.plans.push(planId);
      await repos.productionRepository.confirm(planId, fx.userId);

      const bons = await repos.bonSortieRepository.findByPlan(planId);
      expect(bons).toHaveLength(1);
      const bon = bons[0];
      bonId = bon.id;

      const lines = bon.lines.filter((l: Row) => l.ingredient_id === beurreId);
      const pesage = lines.filter((l: Row) => l.source_location === 'PESAGE');
      const economat = lines.filter((l: Row) => l.source_location === 'ECONOMAT_REQUIRES_TRANSFER');
      const rupture = lines.filter((l: Row) => l.source_location === 'RUPTURE');

      // 1 ligne pesage (0,15 du lot deja ouvert) + 2 lignes economat (0,2 puis 0,15).
      expect(pesage).toHaveLength(1);
      expect(pesage[0].ingredient_lot_id).toBe(lotPesageId);
      expect(num(pesage[0].allocated_quantity)).toBeCloseTo(0.15, 3);
      expect(economat).toHaveLength(2);
      expect(rupture).toHaveLength(0);

      // Aucune ligne (pesage ni economat) ne cible le lot perime.
      const allLots = lines.map((l: Row) => l.ingredient_lot_id).concat(lines.map((l: Row) => l.suggested_economat_lot_id));
      expect(allLots).not.toContain(lotPerimeId);

      // Les lignes economat sont FEFO (DLC la plus proche d'abord) et ne demandent
      // que ce que leur propre lot couvre. Somme pesage + transferts = besoin 0,5.
      const ecoSuggested = economat.map((l: Row) => l.suggested_economat_lot_id);
      expect(new Set(ecoSuggested).size).toBe(2);
      expect(ecoSuggested).toContain(lotEcoAId);
      expect(ecoSuggested).toContain(lotEcoBId);
      const totalTransfer = economat.reduce((s: number, l: Row) => s + num(l.transfer_required_qty), 0);
      expect(num(pesage[0].allocated_quantity) + totalTransfer).toBeCloseTo(0.5, 3);
      for (const l of economat) {
        expect(num(l.transfer_required_qty)).toBeLessThanOrEqual(0.2 + 1e-9);
        expect(num(l.transfer_required_qty)).toBeGreaterThan(0);
      }
    });

    it('pesee multi-lots -> remise -> acceptation chef : la matiere sort UNE fois (0,5 kg)', async () => {
      await repos.bonSortieRepository.markAsPreparation(bonId, fx.userId);
      const bon = (await repos.bonSortieRepository.findByPlan(planId))[0];
      const lines = bon.lines.filter((l: Row) => l.ingredient_id === beurreId);

      // Chaque ligne se pese a sa cible : pesage = allocation, economat = transfert requis.
      const entries = lines.map((l: Row) => ({
        ligneId: l.id as string,
        actualQuantity: l.source_location === 'ECONOMAT_REQUIRES_TRANSFER'
          ? num(l.transfer_required_qty) : num(l.allocated_quantity),
        source: 'manual' as const,
      }));
      await repos.bonSortieRepository.weighLignes(bonId, fx.userId, entries);

      await repos.bonSortieRepository.markAsReady(bonId, fx.userId);
      const closed = await repos.bonSortieRepository.acceptReception(bonId, fx.userId);
      expect(closed.status).toBe('cloture');

      // Stock total : 1,05 - 0,5 = 0,55 (dont 0,5 encore sur le lot perime, non allouable).
      const inv = await testPool().query(
        `SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [beurreId, fx.storeId]
      );
      expect(num(inv.rows[0].current_quantity)).toBeCloseTo(0.55, 3);

      // Le lot perime n'a pas bouge.
      const perime = await testPool().query(
        `SELECT pesage_quantity, economat_quantity FROM ingredient_lots WHERE id = $1`, [lotPerimeId]
      );
      expect(num(perime.rows[0].pesage_quantity) + num(perime.rows[0].economat_quantity)).toBeCloseTo(0.5, 3);

      // Tracabilite lot -> production ecrite (production_lot_usage) sur les lots sains.
      const usage = await testPool().query(
        `SELECT ingredient_lot_id, SUM(quantity_used) AS q FROM production_lot_usage
          WHERE production_plan_id = $1 GROUP BY ingredient_lot_id`, [planId]
      );
      const usedLots = usage.rows.map((r) => r.ingredient_lot_id);
      expect(usedLots).toContain(lotPesageId);
      expect(usedLots).not.toContain(lotPerimeId);
      const totalUsed = usage.rows.reduce((s, r) => s + num(r.q), 0);
      expect(totalUsed).toBeCloseTo(0.5, 3);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. BSI — rupture quand aucun stock, remise bloquee sans "signaler manquants"
  // ══════════════════════════════════════════════════════════════════════════
  describe('BSI — rupture totale (aucun lot)', () => {
    let fx: Fixtures;
    let selId: string; let productId: string; let planId: string; let bonId: string;

    beforeAll(async () => {
      fx = await createBaseFixtures();
      // Ingredient SANS aucun lot : stock 0 -> rupture garantie.
      selId = await createIngredient(fx, { name: 'Sel fin rupture', unit: 'kg', unitCost: 3 });
      const pr = await createProductWithRecipe(fx, {
        name: 'Pain rupture', price: 3, shelfLifeDays: null,
        ingredients: [{ ingredientId: selId, quantity: 1, unit: 'kg' }],
      });
      productId = pr.productId;
      const plan = await repos.productionRepository.create({
        planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
        items: [{ productId, plannedQuantity: 1 }],
      });
      planId = plan.id; fx.ids.plans.push(planId);
      await repos.productionRepository.confirm(planId, fx.userId);
    }, 60_000);

    afterAll(async () => { if (fx) await deepClean(fx); });

    it('BSI : une seule ligne RUPTURE couvrant tout le besoin (1 kg)', async () => {
      const bon = (await repos.bonSortieRepository.findByPlan(planId))[0];
      bonId = bon.id;
      const lines = bon.lines.filter((l: Row) => l.ingredient_id === selId);
      expect(lines).toHaveLength(1);
      expect(lines[0].source_location).toBe('RUPTURE');
      expect(lines[0].status).toBe('rupture');
      expect(num(lines[0].needed_quantity)).toBeCloseTo(1, 3);
      expect(lines[0].ingredient_lot_id).toBeNull();
    });

    it('la ligne remonte dans la file "a commander" (findRuptureRequests)', async () => {
      const reqs = await repos.bonSortieRepository.findRuptureRequests(fx.storeId);
      const mine = (reqs as Row[]).find((r) => r.ingredient_id === selId);
      expect(mine).toBeDefined();
      expect(num(mine!.needed_quantity)).toBeCloseTo(1, 3);
    });

    it('remise au chef refusee tant que le manquant n est pas signale, acceptee avec withMissing', async () => {
      await repos.bonSortieRepository.markAsPreparation(bonId, fx.userId);
      await expect(repos.bonSortieRepository.markAsReady(bonId, fx.userId)).rejects.toThrow(/manquant/i);
      const bon = await repos.bonSortieRepository.markAsReady(bonId, fx.userId, { withMissing: true });
      expect(bon.status).toBe('pret');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. Ingredient non stocke (eau) exclu des besoins / du BSI
  // ══════════════════════════════════════════════════════════════════════════
  describe('Besoins — ingredient non stocke exclu (F-016)', () => {
    let fx: Fixtures;
    let farineId: string; let eauId: string; let productId: string; let planId: string;

    beforeAll(async () => {
      fx = await createBaseFixtures();
      farineId = await createIngredient(fx, { name: 'Farine ns', unit: 'kg', unitCost: 10 });
      await createLot(fx, { ingredientId: farineId, lotNumber: 'F-NS', pesage: 20, economat: 0, expiresInDays: 60, unitCost: 10 });
      eauId = await createIngredient(fx, { name: 'Eau ns', unit: 'l', unitCost: 0 });
      await testPool().query(`UPDATE ingredients SET non_stocke = true WHERE id = $1`, [eauId]);
      const pr = await createProductWithRecipe(fx, {
        name: 'Pain eau ns', price: 3, shelfLifeDays: null,
        ingredients: [
          { ingredientId: farineId, quantity: 0.5, unit: 'kg' },
          { ingredientId: eauId, quantity: 0.2, unit: 'l' },
        ],
      });
      productId = pr.productId;
      const plan = await repos.productionRepository.create({
        planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
        items: [{ productId, plannedQuantity: 10 }],
      });
      planId = plan.id; fx.ids.plans.push(planId);
      await repos.productionRepository.confirm(planId, fx.userId);
    }, 60_000);

    afterAll(async () => { if (fx) await deepClean(fx); });

    it('les besoins portent sur la farine, pas sur l eau non stockee', async () => {
      const needs = await testPool().query(
        `SELECT ingredient_id FROM production_ingredient_needs WHERE plan_id = $1`, [planId]
      );
      const ids = needs.rows.map((r) => r.ingredient_id);
      expect(ids).toContain(farineId);
      expect(ids).not.toContain(eauId);
    });

    it('le BSI genere ne contient aucune ligne eau', async () => {
      const bon = (await repos.bonSortieRepository.findByPlan(planId))[0];
      expect(bon.lines.filter((l: Row) => l.ingredient_id === eauId)).toHaveLength(0);
      expect(bon.lines.filter((l: Row) => l.ingredient_id === farineId).length).toBeGreaterThan(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5. Valorisation des pertes au cout MATIERES (jamais 0 ni prix de vente)
  // ══════════════════════════════════════════════════════════════════════════
  describe('Pertes — valorisation au cout matieres (F-020/F-062)', () => {
    let fx: Fixtures;
    let sucreId: string; let productId: string; let matLotId: string;

    beforeAll(async () => {
      fx = await createBaseFixtures();
      sucreId = await createIngredient(fx, { name: 'Sucre valo', unit: 'kg', unitCost: 8 });
      // Lot matiere pour la perte ingredient (DLC/casse).
      matLotId = await createLot(fx, { ingredientId: sucreId, lotNumber: 'SUC-VALO', pesage: 2, economat: 3, expiresInDays: 10, unitCost: 8 });
      const pr = await createProductWithRecipe(fx, {
        name: 'Macaron valo stk', price: 2, shelfLifeDays: null,   // prix 2, cost_price 0
        ingredients: [{ ingredientId: sucreId, quantity: 0.5, unit: 'kg' }],
      });
      productId = pr.productId;
    }, 60_000);

    afterAll(async () => { if (fx) await deepClean(fx); });

    it('le helper renvoie le cout matieres (0,5 x 8 = 4), pas 0 ni le prix de vente (2)', async () => {
      const cost = await productCostHelper.productMaterialsUnitCost(testPool(), productId);
      expect(cost).toBeCloseTo(4, 3);
      const none = await productCostHelper.productMaterialsUnitCost(testPool(), '00000000-0000-0000-0000-000000000000');
      expect(none).toBe(0);
    });

    it('produit fini DLC depassee : sendToLosses valorise au cout matieres (5 x 4 = 20 DH)', async () => {
      const lot = await testPool().query(
        `INSERT INTO product_lots
           (product_id, store_id, lot_number, quantity_total, backroom_qty, vitrine_qty,
            produced_at, expires_at, status)
         VALUES ($1, $2, $3, 5, 5, 0, NOW(), CURRENT_DATE - 1, 'active') RETURNING id`,
        [productId, fx.storeId, `PF-VALO-STK-${RUN}`]
      );
      const res = await productLotRepository.sendToLosses(lot.rows[0].id, 'dlc_expired', fx.userId, 'Scenario DLC');
      expect(num(res.lostQuantity)).toBeCloseTo(5, 3);
      expect(num(res.lostValue)).toBeCloseTo(20, 2);

      const loss = await testPool().query(
        `SELECT unit_cost, total_cost, loss_type FROM product_losses WHERE source_product_lot_id = $1`, [lot.rows[0].id]
      );
      expect(loss.rows).toHaveLength(1);
      expect(num(loss.rows[0].unit_cost)).toBeCloseTo(4, 2);
      expect(num(loss.rows[0].total_cost)).toBeCloseTo(20, 2);
      expect(num(loss.rows[0].unit_cost)).toBeGreaterThan(0);
    });

    it('ingredient casse au pesage : perte valorisee au cout unitaire du lot (0,5 x 8 = 4 DH)', async () => {
      const res = await ingredientLotRepository.wasteFromPesage(matLotId, 0.5, fx.userId, 'Sac renverse', 'casse');
      expect(num(res.wasted_quantity)).toBeCloseTo(0.5, 3);
      expect(num(res.lost_value)).toBeCloseTo(4, 2);
      expect(num(res.lost_value)).toBeGreaterThan(0);

      // Sortie d'inventaire typee 'waste' sur la seule quantite perdue, pesage decremente.
      const txn = await testPool().query(
        `SELECT type, quantity_change FROM inventory_transactions
          WHERE ingredient_lot_id = $1 AND type = 'waste'`, [matLotId]
      );
      expect(txn.rows).toHaveLength(1);
      expect(num(txn.rows[0].quantity_change)).toBeCloseTo(-0.5, 3);
      const lot = await testPool().query(`SELECT pesage_quantity FROM ingredient_lots WHERE id = $1`, [matLotId]);
      expect(num(lot.rows[0].pesage_quantity)).toBeCloseTo(1.5, 3);  // 2 - 0,5
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 6. Reconciliation vitrine <-> lots (F-045)
  // ══════════════════════════════════════════════════════════════════════════
  describe('Reconciliation vitrine <-> lots (F-045)', () => {
    let fx: Fixtures;
    let productId: string;

    beforeAll(async () => {
      fx = await createBaseFixtures();
      const p = testPool();
      const prod = await p.query(
        `INSERT INTO products (name, slug, price, sale_type, sale_unit)
         VALUES ($1, $2, 6, 'jour', 'unit') RETURNING id`,
        [`Muffin recon ${RUN}`, `muffin-recon-${RUN}`]
      );
      productId = prod.rows[0].id;
      fx.ids.products.push(productId);
      // Vitrine affichee 72, lots ne totalisent que 52 (derive +20 du cote affichage).
      await p.query(
        `INSERT INTO product_store_stock (product_id, store_id, stock_quantity, stock_min_threshold, vitrine_quantity)
         VALUES ($1, $2, 0, 0, 72)`, [productId, fx.storeId]
      );
      for (const [n, qty] of [['A', 40], ['B', 12]] as const) {
        await p.query(
          `INSERT INTO product_lots
             (product_id, store_id, lot_number, quantity_total, vitrine_qty, backroom_qty, produced_at, expires_at, status)
           VALUES ($1, $2, $3, $4, $4, 0, NOW(), CURRENT_DATE + 1, 'active')`,
          [productId, fx.storeId, `PRECON-${n}-${RUN}`, qty]
        );
      }
    }, 60_000);

    afterAll(async () => { if (fx) await deepClean(fx); });

    it('dry-run : rapporte la derive (72 -> 52) sans rien muter', async () => {
      const report = await productLotRepository.reconcileVitrineToLots(fx.storeId, false);
      expect(report.applied).toBe(false);
      const mine = report.drifts.find((d) => d.productId === productId);
      expect(mine).toBeDefined();
      expect(mine!.displayQty).toBeCloseTo(72, 3);
      expect(mine!.lotQty).toBeCloseTo(52, 3);
      expect(mine!.delta).toBeCloseTo(-20, 3);
      const stock = await testPool().query(
        `SELECT vitrine_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`, [productId, fx.storeId]
      );
      expect(num(stock.rows[0].vitrine_quantity)).toBeCloseTo(72, 3);
    });

    it('apply : aligne la vitrine sur les lots (52), trace l ajustement, idempotent', async () => {
      const res = await productLotRepository.reconcileVitrineToLots(fx.storeId, true);
      expect(res.applied).toBe(true);
      const stock = await testPool().query(
        `SELECT vitrine_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`, [productId, fx.storeId]
      );
      expect(num(stock.rows[0].vitrine_quantity)).toBeCloseTo(52, 3);
      const txn = await testPool().query(
        `SELECT quantity_change FROM product_stock_transactions
          WHERE product_id = $1 AND type = 'adjustment' AND note ILIKE '%Reconciliation vitrine%'`, [productId]
      );
      expect(txn.rows).toHaveLength(1);
      expect(num(txn.rows[0].quantity_change)).toBeCloseTo(-20, 3);
      const after = await productLotRepository.reconcileVitrineToLots(fx.storeId, false);
      expect(after.drifts.find((d) => d.productId === productId)).toBeUndefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 7. Reconciliation semi-finis <-> lots (F-044)
  // ══════════════════════════════════════════════════════════════════════════
  describe('Reconciliation semi-finis <-> lots (F-044)', () => {
    let fx: Fixtures;
    let recipeId: string;

    beforeAll(async () => {
      fx = await createBaseFixtures();
      const p = testPool();
      // Recette de base (semi-fini), sans produit requis pour la reconciliation.
      const prod = await p.query(
        `INSERT INTO products (name, slug, price, sale_type) VALUES ($1, $2, 0, 'jour') RETURNING id`,
        [`Base PA sf ${RUN}`, `base-pa-sf-${RUN}`]
      );
      fx.ids.products.push(prod.rows[0].id);
      const rec = await p.query(
        `INSERT INTO recipes (product_id, name, yield_quantity, yield_unit, mode_cout, is_base)
         VALUES ($1, $2, 1, 'kg', 'ratio_poids', true) RETURNING id`,
        [prod.rows[0].id, `Pate d'amande sf ${RUN}`]
      );
      recipeId = rec.rows[0].id;
      fx.ids.recipes.push(recipeId);
      // Stock agrege affiche 28 kg, mais aucun lot actif ne le justifie (lots = 10).
      await p.query(
        `INSERT INTO semi_finished_stock (recipe_id, store_id, quantity_available, unit)
         VALUES ($1, $2, 28, 'kg')`, [recipeId, fx.storeId]
      );
      for (const [n, qty] of [['A', 6], ['B', 4]] as const) {
        await p.query(
          `INSERT INTO semi_finished_lots
             (recipe_id, store_id, lot_number, quantity_produced, quantity_remaining, unit, status)
           VALUES ($1, $2, $3, $4, $4, 'kg', 'active')`,
          [recipeId, fx.storeId, `SFL-${n}-${RUN}`, qty]
        );
      }
    }, 60_000);

    afterAll(async () => { if (fx) await deepClean(fx); });

    it('dry-run : rapporte la derive (28 -> 10) sans rien muter', async () => {
      const report = await stockFrigoRepository.reconcileSemiFinishedToLots(fx.storeId, false);
      expect(report.applied).toBe(false);
      const mine = report.drifts.find((d) => d.recipeId === recipeId);
      expect(mine).toBeDefined();
      expect(mine!.stockQty).toBeCloseTo(28, 3);
      expect(mine!.lotQty).toBeCloseTo(10, 3);
      expect(mine!.delta).toBeCloseTo(-18, 3);
      const s = await testPool().query(
        `SELECT quantity_available FROM semi_finished_stock WHERE recipe_id = $1 AND store_id = $2`, [recipeId, fx.storeId]
      );
      expect(num(s.rows[0].quantity_available)).toBeCloseTo(28, 3);
    });

    it('apply : aligne le stock sur les lots (10), trace l ajustement, idempotent', async () => {
      const res = await stockFrigoRepository.reconcileSemiFinishedToLots(fx.storeId, true);
      expect(res.applied).toBe(true);
      const s = await testPool().query(
        `SELECT quantity_available FROM semi_finished_stock WHERE recipe_id = $1 AND store_id = $2`, [recipeId, fx.storeId]
      );
      expect(num(s.rows[0].quantity_available)).toBeCloseTo(10, 3);
      const txn = await testPool().query(
        `SELECT quantity_change FROM semi_finished_transactions
          WHERE recipe_id = $1 AND type = 'adjustment' AND notes ILIKE '%Reconciliation semi-finis%'`, [recipeId]
      );
      expect(txn.rows).toHaveLength(1);
      expect(num(txn.rows[0].quantity_change)).toBeCloseTo(-18, 3);
      const after = await stockFrigoRepository.reconcileSemiFinishedToLots(fx.storeId, false);
      expect(after.drifts.find((d) => d.recipeId === recipeId)).toBeUndefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 8. Auto-expire des lots produits : DLC (tout) vs DLV seule (vitrine only)
  // ══════════════════════════════════════════════════════════════════════════
  describe('Auto-expire lots produits — DLC vs DLV', () => {
    let fx: Fixtures;
    let sucreId: string; let productDlcId: string; let productDlvId: string;
    let lotDlcId: string; let lotDlvId: string;

    beforeAll(async () => {
      fx = await createBaseFixtures();
      sucreId = await createIngredient(fx, { name: 'Sucre autoexp', unit: 'kg', unitCost: 8 });
      // 2 produits (cout matieres 0,5 x 8 = 4) : un DLC depassee, un DLV seule depassee.
      const prDlc = await createProductWithRecipe(fx, {
        name: 'Tarte dlc', price: 20, shelfLifeDays: null,
        ingredients: [{ ingredientId: sucreId, quantity: 0.5, unit: 'kg' }],
      });
      productDlcId = prDlc.productId;
      const prDlv = await createProductWithRecipe(fx, {
        name: 'Tarte dlv', price: 20, shelfLifeDays: null,
        ingredients: [{ ingredientId: sucreId, quantity: 0.5, unit: 'kg' }],
      });
      productDlvId = prDlv.productId;

      const p = testPool();
      // Lot DLC depassee : 3 vitrine + 2 backroom, tout doit partir.
      const dlc = await p.query(
        `INSERT INTO product_lots
           (product_id, store_id, lot_number, quantity_total, vitrine_qty, backroom_qty, produced_at, expires_at, status)
         VALUES ($1, $2, $3, 5, 3, 2, NOW() - INTERVAL '2 days', CURRENT_DATE - 1, 'active') RETURNING id`,
        [productDlcId, fx.storeId, `AE-DLC-${RUN}`]
      );
      lotDlcId = dlc.rows[0].id;
      await p.query(
        `INSERT INTO product_store_stock (product_id, store_id, stock_quantity, stock_min_threshold, vitrine_quantity)
         VALUES ($1, $2, 2, 0, 3)`, [productDlcId, fx.storeId]
      );
      // Lot DLV seule depassee (DLC encore OK dans 2 j) : 4 vitrine + 6 backroom.
      const dlv = await p.query(
        `INSERT INTO product_lots
           (product_id, store_id, lot_number, quantity_total, vitrine_qty, backroom_qty,
            produced_at, expires_at, first_displayed_at, display_expires_at, status)
         VALUES ($1, $2, $3, 10, 4, 6, NOW() - INTERVAL '1 day', CURRENT_DATE + 2, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 hour', 'active') RETURNING id`,
        [productDlvId, fx.storeId, `AE-DLV-${RUN}`]
      );
      lotDlvId = dlv.rows[0].id;
      await p.query(
        `INSERT INTO product_store_stock (product_id, store_id, stock_quantity, stock_min_threshold, vitrine_quantity)
         VALUES ($1, $2, 6, 0, 4)`, [productDlvId, fx.storeId]
      );

      await productLotRepository.autoExpireDueLots();
    }, 60_000);

    afterAll(async () => { if (fx) await deepClean(fx); });

    it('DLC depassee : tout le lot part aux pertes, statut expired, stock vitrine + reserve a 0', async () => {
      const lot = await testPool().query(
        `SELECT status, vitrine_qty, backroom_qty, wasted_qty FROM product_lots WHERE id = $1`, [lotDlcId]
      );
      expect(lot.rows[0].status).toBe('expired');
      expect(num(lot.rows[0].vitrine_qty)).toBe(0);
      expect(num(lot.rows[0].backroom_qty)).toBe(0);
      expect(num(lot.rows[0].wasted_qty)).toBeCloseTo(5, 3);

      const stock = await testPool().query(
        `SELECT stock_quantity, vitrine_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`,
        [productDlcId, fx.storeId]
      );
      expect(num(stock.rows[0].vitrine_quantity)).toBe(0);
      expect(num(stock.rows[0].stock_quantity)).toBe(0);
    });

    it('DLC : perte valorisee au cout matieres (5 x 4 = 20 DH), pas 0', async () => {
      const loss = await testPool().query(
        `SELECT quantity, unit_cost, total_cost, reason FROM product_losses WHERE source_product_lot_id = $1`, [lotDlcId]
      );
      expect(loss.rows).toHaveLength(1);
      expect(num(loss.rows[0].quantity)).toBeCloseTo(5, 3);
      expect(num(loss.rows[0].unit_cost)).toBeCloseTo(4, 2);
      expect(num(loss.rows[0].total_cost)).toBeCloseTo(20, 2);
      expect(loss.rows[0].reason).toBe('dlc_expiree');
    });

    it('DLV seule : SEULE la vitrine part, le backroom reste vendable, DLV reinitialisee', async () => {
      const lot = await testPool().query(
        `SELECT status, vitrine_qty, backroom_qty, wasted_qty, first_displayed_at, display_expires_at
           FROM product_lots WHERE id = $1`, [lotDlvId]
      );
      expect(lot.rows[0].status).toBe('active');          // DLC encore OK -> lot reste actif
      expect(num(lot.rows[0].vitrine_qty)).toBe(0);
      expect(num(lot.rows[0].backroom_qty)).toBeCloseTo(6, 3);
      expect(num(lot.rows[0].wasted_qty)).toBeCloseTo(4, 3);
      // DLV reinitialisee : la prochaine remise en vitrine redemarre un cycle.
      expect(lot.rows[0].first_displayed_at).toBeNull();
      expect(lot.rows[0].display_expires_at).toBeNull();

      const stock = await testPool().query(
        `SELECT stock_quantity, vitrine_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`,
        [productDlvId, fx.storeId]
      );
      expect(num(stock.rows[0].vitrine_quantity)).toBe(0);     // vitrine purgee
      expect(num(stock.rows[0].stock_quantity)).toBeCloseTo(6, 3);  // reserve intacte
    });

    it('DLV : perte valorisee sur la seule vitrine (4 x 4 = 16 DH)', async () => {
      const loss = await testPool().query(
        `SELECT quantity, unit_cost, total_cost, reason FROM product_losses WHERE source_product_lot_id = $1`, [lotDlvId]
      );
      expect(loss.rows).toHaveLength(1);
      expect(num(loss.rows[0].quantity)).toBeCloseTo(4, 3);
      expect(num(loss.rows[0].total_cost)).toBeCloseTo(16, 2);
      expect(loss.rows[0].reason).toBe('dlv_expiree');
    });
  });
});
