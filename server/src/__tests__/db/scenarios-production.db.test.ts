/**
 * Scenarios PRODUCTION « vie reelle » (chef patissier/boulanger + magasinier),
 * sur base migree (TEST_DATABASE_URL). Chaque bloc isole ses fixtures (RUN) et
 * nettoie en afterAll ; les repositories ouvrent leurs propres connexions, donc
 * les fixtures sont COMMITEES puis supprimees (base jetable).
 *
 * Parcours couverts :
 *  A. Journee du boulanger : brouillon -> confirm (besoins) -> BSI -> pesee ->
 *     cloture -> start -> produceItems -> stock produit + lot fini, pas de double
 *     deduction, auto-complete ; l'eau (non stockee) est exclue des besoins.
 *  B. Garde role<->categorie (controller) : un boulanger ne peut pas planifier un
 *     produit viennoiserie (ROLE_CATEGORY_MISMATCH) ; produit 'general' permis.
 *  C. Semi-finis modele B : recette avec une base (pate). Besoins, plan fils,
 *     matiere consommee UNE seule fois ; recette composee + base imbriquee.
 *  D. Derogation DLC : lot unique perime -> RUPTURE sans motif, alloue+trace avec motif.
 *  E. Relance d'un plan : article annule -> pending, besoins/BSI regeneres.
 *  F. Perte de production (ecart de reception transfert) valorisee au cout
 *     MATIERES reel, pas 0.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, createProductWithRecipe, cleanupFixtures,
  num, RUN, setComposition, type Fixtures,
} from './helpers.js';

const today = () => new Date().toISOString().slice(0, 10);

/** Supprime les liens de sous-recettes des recettes du fixture (nomenclature des formats et
 *  miroir) : il faut couper les liens avant de supprimer la base. */
async function unlinkSubRecipes(recipeIds: string[]) {
  if (recipeIds.length === 0) return;
  await testPool().query(
    `DELETE FROM recipe_format_components WHERE source_recipe_id = ANY($1::uuid[])
        OR format_id IN (SELECT id FROM recipe_formats WHERE recipe_id = ANY($1::uuid[]))`,
    [recipeIds]
  ).catch(() => undefined);
  await testPool().query(
    `DELETE FROM recipe_components WHERE recipe_id = ANY($1::uuid[]) OR source_recipe_id = ANY($1::uuid[])`,
    [recipeIds]
  ).catch(() => undefined);
}

describe.skipIf(!hasTestDb)('Scenarios production — chef & magasinier', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let controller: typeof import('../../controllers/production.controller.js').productionController;

  beforeAll(async () => {
    repos = await importRepositories();
    controller = (await import('../../controllers/production.controller.js')).productionController;
  }, 60_000);

  afterAll(async () => {
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  /** Chaine magasinier d'un BSI : prise en charge -> pesee de toutes les lignes a
   *  la quantite allouee -> remise -> acceptation chef (cloture, matiere sortie). */
  async function runBsiChain(planId: string, userId: string) {
    const bon = (await repos.bonSortieRepository.findByPlan(planId))[0];
    await repos.bonSortieRepository.markAsPreparation(bon.id, userId);
    const fresh = (await repos.bonSortieRepository.findByPlan(planId))[0];
    const entries = (fresh.lines as Record<string, unknown>[])
      .filter((l) => num(l.allocated_quantity) > 0)
      .map((l) => ({ ligneId: l.id as string, actualQuantity: num(l.allocated_quantity), source: 'manual' as const }));
    await repos.bonSortieRepository.weighLignes(bon.id, userId, entries);
    await repos.bonSortieRepository.markAsReady(bon.id, userId);
    return repos.bonSortieRepository.acceptReception(bon.id, userId);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // A. Journee du boulanger : parcours complet + eau non stockee exclue
  // ──────────────────────────────────────────────────────────────────────────
  describe('A. Parcours complet baguette (BSI -> produceItems -> lot fini)', () => {
    let fx: Fixtures;
    let farineId: string; let eauId: string; let lotFarineId: string;
    let productId: string; let planId: string; let planItemId: string;
    let invFarineBefore: number;

    beforeAll(async () => {
      fx = await createBaseFixtures();
      farineId = await createIngredient(fx, { name: 'Farine A', unit: 'kg', unitCost: 10 });
      eauId = await createIngredient(fx, { name: 'Eau A', unit: 'l', unitCost: 0 });
      await testPool().query(`UPDATE ingredients SET non_stocke = true WHERE id = $1`, [eauId]);
      lotFarineId = await createLot(fx, { ingredientId: farineId, lotNumber: 'FAR', pesage: 50, expiresInDays: 30, unitCost: 10 });
      const pr = await createProductWithRecipe(fx, {
        name: 'Baguette A', price: 3, shelfLifeDays: null,
        ingredients: [
          { ingredientId: farineId, quantity: 0.5, unit: 'kg' },
          { ingredientId: eauId, quantity: 0.2, unit: 'l' },
        ],
      });
      productId = pr.productId;
      const inv = await testPool().query(`SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [farineId, fx.storeId]);
      invFarineBefore = num(inv.rows[0]?.current_quantity);
    }, 60_000);

    afterAll(async () => { if (fx) await cleanupFixtures(fx); });

    it('confirm : besoins sur la farine (5 kg), l eau non stockee exclue', async () => {
      const plan = await repos.productionRepository.create({
        planDate: today(), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
        items: [{ productId, plannedQuantity: 10 }],
      });
      planId = plan.id; fx.ids.plans.push(planId);
      const { warnings } = await repos.productionRepository.confirm(planId, fx.userId);
      expect(warnings).toEqual([]);

      const needs = await testPool().query(
        `SELECT ingredient_id, needed_quantity FROM production_ingredient_needs WHERE plan_id = $1`, [planId]
      );
      const ids = needs.rows.map((r) => r.ingredient_id);
      expect(ids).toContain(farineId);
      expect(ids).not.toContain(eauId);
      expect(num(needs.rows.find((r) => r.ingredient_id === farineId)!.needed_quantity)).toBeCloseTo(5, 3);

      const items = await testPool().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [planId]);
      planItemId = items.rows[0].id;
    });

    it('BSI genere : une ligne farine (FEFO), aucune ligne eau', async () => {
      const bons = await repos.bonSortieRepository.findByPlan(planId);
      expect(bons).toHaveLength(1);
      const lines = bons[0].lines as Record<string, unknown>[];
      expect(lines.filter((l) => l.ingredient_id === eauId)).toHaveLength(0);
      const farineLines = lines.filter((l) => l.ingredient_id === farineId);
      expect(farineLines).toHaveLength(1);
      expect(farineLines[0].ingredient_lot_id).toBe(lotFarineId);
      expect(num(farineLines[0].allocated_quantity)).toBeCloseTo(5, 3);
    });

    it('pesee + acceptation : la farine sort UNE fois (50 -> 45)', async () => {
      const closed = await runBsiChain(planId, fx.userId);
      expect(closed.status).toBe('cloture');
      const lot = await testPool().query(`SELECT pesage_quantity FROM ingredient_lots WHERE id = $1`, [lotFarineId]);
      expect(num(lot.rows[0].pesage_quantity)).toBeCloseTo(45, 3);
      const inv = await testPool().query(`SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [farineId, fx.storeId]);
      expect(num(inv.rows[0].current_quantity)).toBeCloseTo(invFarineBefore - 5, 3);
    });

    it('start + produceItems : stock produit + lot fini, pas de double deduction, auto-complete', async () => {
      await repos.productionRepository.start(planId, fx.userId);
      const res = await repos.productionRepository.produceItems(planId, [{ planItemId, actualQuantity: 10 }], fx.userId, fx.storeId);
      expect(res.autoCompleted).toBe(true);

      const stock = await testPool().query(`SELECT stock_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`, [productId, fx.storeId]);
      expect(num(stock.rows[0].stock_quantity)).toBeCloseTo(10, 3);

      const lots = await testPool().query(
        `SELECT quantity_total, backroom_qty FROM product_lots WHERE production_plan_id = $1 AND product_id = $2`, [planId, productId]
      );
      expect(lots.rows).toHaveLength(1);
      expect(num(lots.rows[0].quantity_total)).toBeCloseTo(10, 3);
      expect(num(lots.rows[0].backroom_qty)).toBeCloseTo(10, 3);

      // Pas de double deduction : le BSI avait deja sorti la matiere.
      const lot = await testPool().query(`SELECT pesage_quantity FROM ingredient_lots WHERE id = $1`, [lotFarineId]);
      expect(num(lot.rows[0].pesage_quantity)).toBeCloseTo(45, 3);

      const plan = await testPool().query(`SELECT status, completion_type FROM production_plans WHERE id = $1`, [planId]);
      expect(plan.rows[0].status).toBe('completed');
      expect(plan.rows[0].completion_type).toBe('complete');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // B. Garde role <-> categorie (controller create)
  // ──────────────────────────────────────────────────────────────────────────
  describe('B. Garde role <-> categorie a la planification', () => {
    let fx: Fixtures;
    let bakerId: string;
    let vienProductId: string; let generalProductId: string;
    let vienCatId: number;

    const mockRes = () => {
      const r: { statusCode: number; body: any; status: (c: number) => any; json: (b: any) => any } = {
        statusCode: 200, body: null,
        status(c: number) { r.statusCode = c; return r; },
        json(b: any) { r.body = b; return r; },
      };
      return r;
    };

    beforeAll(async () => {
      fx = await createBaseFixtures();
      const baker = await testPool().query(
        `INSERT INTO users (email, password_hash, first_name, last_name, role, store_id)
         VALUES ($1, 'x', 'Jean', 'Boulanger', 'baker', $2) RETURNING id`,
        [`baker-${RUN}@test.local`, fx.storeId]
      );
      bakerId = baker.rows[0].id;

      // Categorie viennoiserie (slug mappe au role 'viennoiserie' dans @ofauria/shared).
      const cat = await testPool().query(`SELECT id FROM categories WHERE slug = 'viennoiseries' LIMIT 1`);
      vienCatId = cat.rows[0]?.id
        ?? (await testPool().query(
          `INSERT INTO categories (name, slug) VALUES ($1, 'viennoiseries') RETURNING id`, [`Viennoiseries ${RUN}`]
        )).rows[0].id;

      const vien = await createProductWithRecipe(fx, { name: 'Croissant B', price: 2, ingredients: [] });
      vienProductId = vien.productId;
      await testPool().query(`UPDATE products SET category_id = $1 WHERE id = $2`, [vienCatId, vienProductId]);

      const gen = await createProductWithRecipe(fx, { name: 'Produit general B', price: 2, ingredients: [] });
      generalProductId = gen.productId;   // category_id NULL -> role 'general'
    }, 60_000);

    afterAll(async () => {
      await testPool().query(`DELETE FROM users WHERE id = $1`, [bakerId]).catch(() => undefined);
      if (fx) await cleanupFixtures(fx);
    });

    it('un boulanger ne peut pas planifier une viennoiserie : 403 ROLE_CATEGORY_MISMATCH', async () => {
      const req: any = {
        body: { planDate: today(), type: 'daily', items: [{ productId: vienProductId, plannedQuantity: 5 }] },
        user: { userId: bakerId, role: 'baker', storeId: fx.storeId },
      };
      const res = mockRes();
      await controller.create(req, res as any);
      expect(res.statusCode).toBe(403);
      expect(res.body?.error?.code).toBe('ROLE_CATEGORY_MISMATCH');
      // Rien n'a ete cree.
      const cnt = await testPool().query(
        `SELECT COUNT(*)::int AS n FROM production_plan_items WHERE product_id = $1`, [vienProductId]
      );
      expect(cnt.rows[0].n).toBe(0);
    });

    it('un boulanger peut planifier un produit general (aucune categorie atelier)', async () => {
      const req: any = {
        body: { planDate: today(), type: 'daily', items: [{ productId: generalProductId, plannedQuantity: 5 }] },
        user: { userId: bakerId, role: 'baker', storeId: fx.storeId },
      };
      const res = mockRes();
      await controller.create(req, res as any);
      expect(res.statusCode).toBe(201);
      expect(res.body?.success).toBe(true);
      const planId = res.body.data.id as string;
      fx.ids.plans.push(planId);
      // Le plan d'un chef s'auto-assigne son role.
      const plan = await testPool().query(`SELECT target_role FROM production_plans WHERE id = $1`, [planId]);
      expect(plan.rows[0].target_role).toBe('baker');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // C. Semi-finis modele B (base pate)
  // ──────────────────────────────────────────────────────────────────────────
  describe('C. Semi-finis modele B — base « pate »', () => {
    let fx: Fixtures;
    let beurreId: string; let lotBeurreId: string;
    let baseRecipeId: string;           // « Pate » is_base = true
    let productId: string; let recipeId: string;
    let planId: string; let planItemId: string;
    let invBeurreBefore: number;

    beforeAll(async () => {
      fx = await createBaseFixtures();
      beurreId = await createIngredient(fx, { name: 'Beurre C', unit: 'kg', unitCost: 20 });
      lotBeurreId = await createLot(fx, { ingredientId: beurreId, lotNumber: 'BEU', pesage: 100, expiresInDays: 30, unitCost: 20 });

      // Base « Pate » : 1 kg de pate = 1 kg de beurre. Pas de produit (is_base).
      const base = await testPool().query(
        `INSERT INTO recipes (product_id, name, yield_quantity, yield_unit, mode_cout, is_base)
         VALUES (NULL, $1, 1, 'kg', 'ratio_poids', true) RETURNING id`,
        [`Pate C ${RUN}`]
      );
      baseRecipeId = base.rows[0].id; fx.ids.recipes.push(baseRecipeId);
      await setComposition(baseRecipeId, { ingredients: [{ ingredientId: beurreId, quantity: 1, unit: 'kg' }] });

      // Produit « Tarte » : 0,2 kg de pate par tarte (sous-recette de base).
      const pr = await createProductWithRecipe(fx, { name: 'Tarte C', price: 10, ingredients: [] });
      productId = pr.productId; recipeId = pr.recipeId;
      await setComposition(recipeId, { subRecipes: [{ subRecipeId: baseRecipeId, quantity: 0.2 }] });
      const inv = await testPool().query(`SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [beurreId, fx.storeId]);
      invBeurreBefore = num(inv.rows[0]?.current_quantity);
    }, 60_000);

    afterAll(async () => {
      const p = testPool();
      const childPlans = await p.query(
        `SELECT id FROM production_plans WHERE store_id = $1 AND is_semi_finished_plan = true`, [fx.storeId]
      ).catch(() => ({ rows: [] as { id: string }[] }));
      const childIds = childPlans.rows.map((r) => r.id);
      await p.query(`DELETE FROM semi_finished_lot_usage WHERE parent_plan_id = ANY($1::uuid[])`, [[...fx.ids.plans, ...childIds]]).catch(() => undefined);
      await p.query(`DELETE FROM semi_finished_lots WHERE recipe_id = $1`, [baseRecipeId]).catch(() => undefined);
      await p.query(`DELETE FROM semi_finished_transactions WHERE recipe_id = $1`, [baseRecipeId]).catch(() => undefined);
      await p.query(`DELETE FROM semi_finished_stock WHERE recipe_id = $1`, [baseRecipeId]).catch(() => undefined);
      await p.query(`DELETE FROM production_plan_dependencies WHERE sub_recipe_id = $1 OR parent_plan_id = ANY($2::uuid[])`, [baseRecipeId, fx.ids.plans]).catch(() => undefined);
      for (const id of childIds) {
        await p.query(`DELETE FROM production_lot_usage WHERE production_plan_id = $1`, [id]).catch(() => undefined);
        await p.query(`DELETE FROM production_plans WHERE id = $1`, [id]).catch(() => undefined);
      }
      await unlinkSubRecipes(fx.ids.recipes);
      if (fx) await cleanupFixtures(fx);
    });

    // Modele B (F-044) : confirm() detecte les bases AVANT de calculer les besoins.
    // La pate devient un plan fils ; le parent ne developpe plus la base en matieres
    // (sinon double comptage) et c'est la production du plan fils qui consomme le beurre.
    it('confirm : la pate devient un plan fils, le parent ne porte pas le beurre', async () => {
      const plan = await repos.productionRepository.create({
        planDate: today(), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
        items: [{ productId, plannedQuantity: 10 }],
      });
      planId = plan.id; fx.ids.plans.push(planId);
      const items = await testPool().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [planId]);
      planItemId = items.rows[0].id;

      await repos.productionRepository.confirm(planId, fx.userId);
      const needs = await testPool().query(
        `SELECT needed_quantity FROM production_ingredient_needs WHERE plan_id = $1 AND ingredient_id = $2`,
        [planId, beurreId]
      );
      expect(needs.rows).toHaveLength(0);

      // 10 tartes x 0,2 kg de pate = 2 kg de pate a produire.
      const dbDep = await testPool().query(
        `SELECT status, dependency_plan_id, quantity_needed, quantity_to_produce
           FROM production_plan_dependencies WHERE parent_plan_id = $1 AND sub_recipe_id = $2`,
        [planId, baseRecipeId]
      );
      expect(dbDep.rows).toHaveLength(1);
      expect(dbDep.rows[0].status).toBe('pending');
      expect(dbDep.rows[0].dependency_plan_id).not.toBeNull();
      expect(num(dbDep.rows[0].quantity_needed)).toBeCloseTo(2, 2);
      expect(num(dbDep.rows[0].quantity_to_produce)).toBeCloseTo(2, 2);
    });

    it('detection idempotente : un second appel ne cree pas de nouveau plan fils', async () => {
      const det = await repos.productionRepository.detectAndCreateSemiFinishedPlans(planId, fx.userId);
      expect(det.dependencyPlanIds).toHaveLength(0);
      const deps = await testPool().query(
        `SELECT COUNT(*)::int AS n FROM production_plan_dependencies WHERE parent_plan_id = $1`, [planId]
      );
      expect(deps.rows[0].n).toBe(1);
    });

    it('start du parent refuse tant que le semi-fini n est pas produit', async () => {
      await expect(repos.productionRepository.start(planId, fx.userId)).rejects.toThrow(/[Ss]emi-finis? en attente/);
    });

    it('matiere consommee UNE SEULE fois : la production du plan fils deduit le beurre (100 -> 98)', async () => {
      const dep = await testPool().query(
        `SELECT dependency_plan_id FROM production_plan_dependencies WHERE parent_plan_id = $1 AND sub_recipe_id = $2`,
        [planId, baseRecipeId]
      );
      const childPlanId = dep.rows[0].dependency_plan_id as string;
      const childItem = await testPool().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [childPlanId]);

      await repos.productionRepository.confirm(childPlanId, fx.userId);
      await repos.productionRepository.start(childPlanId, fx.userId);
      await repos.productionRepository.produceItems(childPlanId, [{ planItemId: childItem.rows[0].id, actualQuantity: 2 }], fx.userId, fx.storeId);

      // Plan fils sans bon de sortie : la matiere de la pate sort a la declaration,
      // 2 kg de pate x 1 kg de beurre par kg = 2 kg, une seule fois.
      const invAfterChild = num((await testPool().query(
        `SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [beurreId, fx.storeId]
      )).rows[0].current_quantity);
      expect(invAfterChild).toBeCloseTo(invBeurreBefore - 2, 3);

      // Le semi-fini a bien ete produit (stock + lot de pate).
      const sfStock = await testPool().query(
        `SELECT quantity_available FROM semi_finished_stock WHERE recipe_id = $1 AND store_id = $2`, [baseRecipeId, fx.storeId]
      );
      // Modele B : les 2 kg produits pour le parent lui sont aussitot affectes (stock
      // disponible a 0, lot de pate rattache au parent par semi_finished_lot_usage).
      expect(num(sfStock.rows[0].quantity_available)).toBeCloseTo(0, 3);
      const usage = await testPool().query(
        `SELECT COALESCE(SUM(quantity), 0) AS q FROM semi_finished_lot_usage WHERE parent_plan_id = $1`, [planId]
      );
      expect(num(usage.rows[0].q)).toBeCloseTo(2, 3);
      const dependencyNow = await testPool().query(
        `SELECT status FROM production_plan_dependencies WHERE parent_plan_id = $1 AND sub_recipe_id = $2`, [planId, baseRecipeId]
      );
      expect(dependencyNow.rows[0].status).toBe('fulfilled');
    });

    it('le parent ne porte toujours aucun beurre : pas de seconde deduction possible', async () => {
      const bons = await repos.bonSortieRepository.findByPlan(planId);
      const beurreLines = bons.flatMap((b: Record<string, unknown>) => (b.lines as Record<string, unknown>[]) ?? [])
        .filter((l) => l.ingredient_id === beurreId);
      expect(beurreLines).toHaveLength(0);
      const inv = await testPool().query(`SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [beurreId, fx.storeId]);
      expect(num(inv.rows[0].current_quantity)).toBeCloseTo(invBeurreBefore - 2, 3);
      expect(lotBeurreId).toBeTruthy();
    });

    it('base imbriquee : le plan fils de la base descend recursivement dans la base de base', async () => {
      // « Pate feuilletee » (base) contient 0,5 kg de « Pate C » (base) par kg.
      const feuil = await testPool().query(
        `INSERT INTO recipes (product_id, name, yield_quantity, yield_unit, mode_cout, is_base)
         VALUES (NULL, $1, 1, 'kg', 'ratio_poids', true) RETURNING id`,
        [`Pate feuilletee C ${RUN}`]
      );
      const feuilId = feuil.rows[0].id as string; fx.ids.recipes.push(feuilId);
      await setComposition(feuilId, { subRecipes: [{ subRecipeId: baseRecipeId, quantity: 0.5 }] });
      const prod2 = await createProductWithRecipe(fx, { name: 'Mille-feuille C', price: 15, ingredients: [] });
      await setComposition(prod2.recipeId, { subRecipes: [{ subRecipeId: feuilId, quantity: 1 }] });

      const plan2 = await repos.productionRepository.create({
        planDate: today(), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
        items: [{ productId: prod2.productId, plannedQuantity: 4 }],
      });
      fx.ids.plans.push(plan2.id);
      await repos.productionRepository.confirm(plan2.id, fx.userId);

      // La feuilletee (base directe) devient un plan fils de 4 kg.
      const dep = await testPool().query(
        `SELECT dependency_plan_id, quantity_to_produce FROM production_plan_dependencies WHERE parent_plan_id = $1 AND sub_recipe_id = $2`,
        [plan2.id, feuilId]
      );
      expect(dep.rows).toHaveLength(1);
      expect(num(dep.rows[0].quantity_to_produce)).toBeCloseTo(4, 2);
      const childPlanId = dep.rows[0].dependency_plan_id as string;
      const childItem = await testPool().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [childPlanId]);

      const invBefore = num((await testPool().query(
        `SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [beurreId, fx.storeId]
      )).rows[0].current_quantity);
      await repos.productionRepository.confirm(childPlanId, fx.userId);
      await repos.productionRepository.start(childPlanId, fx.userId);
      await repos.productionRepository.produceItems(childPlanId, [{ planItemId: childItem.rows[0].id, actualQuantity: 4 }], fx.userId, fx.storeId);

      // 4 kg feuilletee x 0,5 kg pate x 1 kg beurre = 2 kg beurre, descendus recursivement.
      const invAfter = num((await testPool().query(
        `SELECT current_quantity FROM inventory WHERE ingredient_id = $1 AND store_id = $2`, [beurreId, fx.storeId]
      )).rows[0].current_quantity);
      expect(invAfter).toBeCloseTo(invBefore - 2, 3);
    });

    it('recette composee : la composition (recipe_components) alimente les besoins', async () => {
      // Produit en mode 'compose' : la compo vit dans recipe_components, pas dans
      // recipe_ingredients. Le helper doit malgre tout calculer les besoins.
      const sucreId = await createIngredient(fx, { name: 'Sucre C', unit: 'kg', unitCost: 8 });
      await createLot(fx, { ingredientId: sucreId, lotNumber: 'SUC', pesage: 50, expiresInDays: 30, unitCost: 8 });
      const prod3 = await createProductWithRecipe(fx, { name: 'Entremet compose C', price: 20, ingredients: [] });
      await testPool().query(`UPDATE recipes SET mode_cout = 'compose', compo_par_piece = true WHERE id = $1`, [prod3.recipeId]);
      await testPool().query(
        `INSERT INTO recipe_components (recipe_id, source_ingredient_id, quantite, unite) VALUES ($1, $2, 0.3, 'kg')`,
        [prod3.recipeId, sucreId]
      );

      const plan3 = await repos.productionRepository.create({
        planDate: today(), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
        items: [{ productId: prod3.productId, plannedQuantity: 10 }],
      });
      fx.ids.plans.push(plan3.id);
      await repos.productionRepository.confirm(plan3.id, fx.userId);

      const needs = await testPool().query(
        `SELECT needed_quantity FROM production_ingredient_needs WHERE plan_id = $1 AND ingredient_id = $2`, [plan3.id, sucreId]
      );
      // compo_par_piece : 10 pieces x 0,3 kg = 3 kg.
      expect(needs.rows).toHaveLength(1);
      expect(num(needs.rows[0].needed_quantity)).toBeCloseTo(3, 3);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // D. Derogation DLC : lot unique perime
  // ──────────────────────────────────────────────────────────────────────────
  describe('D. Derogation DLC sur lot perime', () => {
    let fx: Fixtures;
    let levureId: string; let lotExpiredId: string;
    let productId: string; let planId: string;

    beforeAll(async () => {
      fx = await createBaseFixtures();
      levureId = await createIngredient(fx, { name: 'Levure D', unit: 'kg', unitCost: 5 });
      // Unique lot disponible : perime (DLC hier), statut encore 'active'.
      lotExpiredId = await createLot(fx, { ingredientId: levureId, lotNumber: 'LEV-PERIME', pesage: 10, expiresInDays: -1, unitCost: 5 });
      const pr = await createProductWithRecipe(fx, {
        name: 'Pain levure D', price: 3, shelfLifeDays: null,
        ingredients: [{ ingredientId: levureId, quantity: 0.5, unit: 'kg' }],
      });
      productId = pr.productId;
      const plan = await repos.productionRepository.create({
        planDate: today(), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
        items: [{ productId, plannedQuantity: 10 }],
      });
      planId = plan.id; fx.ids.plans.push(planId);
      await repos.productionRepository.confirm(planId, fx.userId);
    }, 60_000);

    afterAll(async () => { if (fx) await cleanupFixtures(fx); });

    it('sans motif : le lot perime est ecarte, la ligne part en RUPTURE', async () => {
      const sans = await repos.bonSortieRepository.regenerate(planId, fx.storeId, fx.userId);
      const lignes = (sans.lines as Record<string, unknown>[]).filter((l) => l.ingredient_id === levureId);
      expect(lignes.some((l) => l.ingredient_lot_id === lotExpiredId)).toBe(false);
      expect(lignes.some((l) => l.source_location === 'RUPTURE')).toBe(true);
      expect(sans.expired_lots_skipped).toHaveLength(1);
    });

    it('avec motif : le lot perime est alloue et la decision tracee', async () => {
      const avec = await repos.bonSortieRepository.regenerate(planId, fx.storeId, fx.userId, {
        derogationDlc: { motif: 'Controle organoleptique OK, levure utilisee en cuisson' },
      });
      const surPerime = (avec.lines as Record<string, unknown>[]).find((l) => l.ingredient_lot_id === lotExpiredId);
      expect(surPerime).toBeDefined();
      expect(surPerime!.derogation_dlc).toBe(true);
      expect(num(surPerime!.allocated_quantity)).toBeCloseTo(5, 3);
      expect(avec.expired_lots_skipped).toEqual([]);

      const header = await testPool().query(
        `SELECT derogation_dlc_motif, derogation_dlc_by, derogation_dlc_at FROM production_bons_sortie WHERE id = $1`, [avec.id]
      );
      expect(header.rows[0].derogation_dlc_motif).toMatch(/organoleptique/);
      expect(header.rows[0].derogation_dlc_by).toBe(fx.userId);
      expect(header.rows[0].derogation_dlc_at).not.toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // E. Relance d'un plan (article annule -> pending, BSI regenere)
  // ──────────────────────────────────────────────────────────────────────────
  describe('E. Relance d un plan', () => {
    let fx: Fixtures;
    let farineId: string;
    let prodAId: string; let prodBId: string;
    let planId: string; let itemAId: string; let itemBId: string;

    beforeAll(async () => {
      fx = await createBaseFixtures();
      farineId = await createIngredient(fx, { name: 'Farine E', unit: 'kg', unitCost: 10 });
      await createLot(fx, { ingredientId: farineId, lotNumber: 'FAR-E', pesage: 100, expiresInDays: 30, unitCost: 10 });
      const a = await createProductWithRecipe(fx, { name: 'Pain A E', price: 3, ingredients: [{ ingredientId: farineId, quantity: 0.5, unit: 'kg' }] });
      const b = await createProductWithRecipe(fx, { name: 'Pain B E', price: 3, ingredients: [{ ingredientId: farineId, quantity: 1, unit: 'kg' }] });
      prodAId = a.productId; prodBId = b.productId;
      const plan = await repos.productionRepository.create({
        planDate: today(), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
        items: [{ productId: prodAId, plannedQuantity: 10 }, { productId: prodBId, plannedQuantity: 10 }],
      });
      planId = plan.id; fx.ids.plans.push(planId);
      await repos.productionRepository.confirm(planId, fx.userId);
      const items = await testPool().query(`SELECT id, product_id FROM production_plan_items WHERE plan_id = $1`, [planId]);
      itemAId = items.rows.find((r) => r.product_id === prodAId)!.id;
      itemBId = items.rows.find((r) => r.product_id === prodBId)!.id;
    }, 60_000);

    afterAll(async () => { if (fx) await cleanupFixtures(fx); });

    it('annulation d un article : il passe en cancelled, son besoin disparait a la relance', async () => {
      const { cancelledCount } = await repos.productionRepository.cancelItems(planId, [itemBId], 'Rupture four');
      expect(cancelledCount).toBe(1);
      const st = await testPool().query(`SELECT status FROM production_plan_items WHERE id = $1`, [itemBId]);
      expect(st.rows[0].status).toBe('cancelled');
    });

    it('relance : l article annule revient en pending et les besoins/BSI sont regeneres', async () => {
      const res = await repos.productionRepository.relaunch(planId, fx.userId, [itemBId]);
      expect(res.relaunchedCount).toBeGreaterThanOrEqual(1);

      const st = await testPool().query(`SELECT status, cancellation_reason FROM production_plan_items WHERE id = $1`, [itemBId]);
      expect(st.rows[0].status).toBe('pending');
      expect(st.rows[0].cancellation_reason).toBeNull();

      // Besoins recalcules (BSI non encore preleve) : A (5 kg) + B (10 kg) presents.
      const needs = await testPool().query(
        `SELECT product_id, needed_quantity FROM production_ingredient_needs WHERE plan_id = $1 AND ingredient_id = $2`,
        [planId, farineId]
      );
      const byProduct = new Map(needs.rows.map((r) => [r.product_id, num(r.needed_quantity)]));
      expect(byProduct.get(prodAId)).toBeCloseTo(5, 3);
      expect(byProduct.get(prodBId)).toBeCloseTo(10, 3);

      // Un BSI actif (non annule) est de nouveau disponible pour ce plan.
      const bon = (await repos.bonSortieRepository.findByPlan(planId))[0];
      expect(['genere', 'awaiting', 'prelevement']).toContain(bon.status);
      const farineAlloc = (bon.lines as Record<string, unknown>[])
        .filter((l) => l.ingredient_id === farineId)
        .reduce((s, l) => s + num(l.allocated_quantity), 0);
      expect(farineAlloc).toBeCloseTo(15, 3);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // F. Perte de production valorisee au cout matieres reel
  // ──────────────────────────────────────────────────────────────────────────
  describe('F. Perte de production (ecart reception) valorisee au cout matieres', () => {
    let fx: Fixtures;
    let sucreId: string;
    let productId: string; let planId: string; let planItemId: string;

    beforeAll(async () => {
      fx = await createBaseFixtures();
      sucreId = await createIngredient(fx, { name: 'Sucre F', unit: 'kg', unitCost: 8 });
      await createLot(fx, { ingredientId: sucreId, lotNumber: 'SUC-F', pesage: 100, expiresInDays: 30, unitCost: 8 });
      // cost_price = 0, prix de vente 2 ; cout MATIERES = 0,5 x 8 = 4 DH/u.
      const pr = await createProductWithRecipe(fx, {
        name: 'Macaron F', price: 2, shelfLifeDays: null,
        ingredients: [{ ingredientId: sucreId, quantity: 0.5, unit: 'kg' }],
      });
      productId = pr.productId;
      const plan = await repos.productionRepository.create({
        planDate: today(), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
        items: [{ productId, plannedQuantity: 10 }],
      });
      planId = plan.id; fx.ids.plans.push(planId);
      await repos.productionRepository.confirm(planId, fx.userId);
      const items = await testPool().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [planId]);
      planItemId = items.rows[0].id;
    }, 60_000);

    afterAll(async () => {
      if (fx) {
        await testPool().query(`DELETE FROM product_losses WHERE store_id = $1`, [fx.storeId]).catch(() => undefined);
        await testPool().query(`DELETE FROM production_transfer_items WHERE transfer_id IN (SELECT id FROM production_transfers WHERE store_id = $1)`, [fx.storeId]).catch(() => undefined);
        await testPool().query(`DELETE FROM production_transfers WHERE store_id = $1`, [fx.storeId]).catch(() => undefined);
        await cleanupFixtures(fx);
      }
    });

    it('produit 10, transfere, mais 7 recus : perte de 3 valorisee a 3 x 4 = 12 DH (pas 0)', async () => {
      await runBsiChain(planId, fx.userId);
      await repos.productionRepository.start(planId, fx.userId);
      await repos.productionRepository.produceItems(planId, [{ planItemId, actualQuantity: 10 }], fx.userId, fx.storeId);

      const transfer = await repos.productionRepository.createTransfer(planId, [planItemId], fx.userId, fx.storeId);
      const tItem = await testPool().query(`SELECT id FROM production_transfer_items WHERE transfer_id = $1`, [transfer.id]);
      await repos.productionRepository.confirmTransferReception(transfer.id, [{ itemId: tItem.rows[0].id, qtyReceived: 7 }], fx.userId);

      const loss = await testPool().query(
        `SELECT quantity, unit_cost, total_cost, loss_type FROM product_losses WHERE product_id = $1 AND production_plan_id = $2`,
        [productId, planId]
      );
      expect(loss.rows).toHaveLength(1);
      expect(num(loss.rows[0].quantity)).toBeCloseTo(3, 3);
      expect(loss.rows[0].loss_type).toBe('production');
      expect(num(loss.rows[0].unit_cost)).toBeCloseTo(4, 2);   // cout matieres, pas 0
      expect(num(loss.rows[0].unit_cost)).toBeGreaterThan(0);
      expect(num(loss.rows[0].total_cost)).toBeCloseTo(12, 2);

      // Le stock produit suit la quantite reellement recue (10 -> 7).
      const stock = await testPool().query(`SELECT stock_quantity FROM product_store_stock WHERE product_id = $1 AND store_id = $2`, [productId, fx.storeId]);
      expect(num(stock.rows[0].stock_quantity)).toBeCloseTo(7, 3);
    });
  });
});
