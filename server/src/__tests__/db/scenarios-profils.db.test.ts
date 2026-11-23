/**
 * Profils de référence — scénarios B et C (plan d'exécution multi-industries, étape 12).
 *
 * B — Agroalimentaire conditionné : lot à DDM, contrôle final qui retient le lot,
 *     non-conformité numérotée, traçabilité amont et aval, rappel.
 * C — Mécanique et assemblage : réservation de matière à la confirmation, opération sur un
 *     poste avec coût machine réel, numéros de série.
 * (D — Textile : dépend des variantes d'article, étape 13, sur demande.)
 */
process.env.POS_ALLOW_NEGATIVE_STOCK = 'off';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, createProductWithRecipe, cleanupFixtures,
  num, RUN, type Fixtures,
} from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe.skipIf(!hasTestDb)('Étape 12 — scénarios des profils de référence', () => {
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let sectors: any; let policies: any; let saved: Record<string, boolean> = {};
  let fx: Fixtures;
  const p = () => testPool();
  const cleanup: { categories: number[]; wcs: string[]; ncs: string[]; recalls: string[] } = { categories: [], wcs: [], ncs: [], recalls: [] };

  beforeAll(async () => {
    repos = await importRepositories();
    sectors = (await import('../../repositories/sector.repository.js')).sectorRepository;
    policies = await import('../../services/policies.js');
    saved = { ...(await sectors.activation()).featureOverrides };
    await p().query(`DELETE FROM policy_values WHERE key IN ('production.cost_components', 'quality.auto_release')`);
    policies.invalidatePolicies();
    fx = await createBaseFixtures();
  }, 60_000);

  afterAll(async () => {
    await sectors?.applyAdjustments({ features: { reservation_matiere: saved.reservation_matiere ?? null } }).catch(() => undefined);
    await p().query(`DELETE FROM policy_values WHERE key IN ('production.cost_components', 'quality.auto_release')`).catch(() => undefined);
    policies?.invalidatePolicies();
    for (const id of cleanup.recalls) await p().query(`DELETE FROM recalls WHERE id = $1`, [id]).catch(() => undefined);
    for (const id of cleanup.ncs) await p().query(`DELETE FROM quality_nonconformities WHERE id = $1`, [id]).catch(() => undefined);
    for (const pid of fx?.ids.plans ?? []) {
      await p().query(`DELETE FROM quality_inspections WHERE plan_id = $1`, [pid]).catch(() => undefined);
      await p().query(`DELETE FROM production_cout_reel WHERE plan_id = $1`, [pid]).catch(() => undefined);
    }
    await p().query(`DELETE FROM quality_control_plan_lines WHERE product_category_id = ANY($1::int[])`, [cleanup.categories]).catch(() => undefined);
    if (fx) await cleanupFixtures(fx);
    for (const id of cleanup.categories) await p().query(`DELETE FROM categories WHERE id = $1`, [id]).catch(() => undefined);
    for (const id of cleanup.wcs) await p().query(`DELETE FROM work_centers WHERE id = $1`, [id]).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  async function runToProduced(productId: string, qty: number) {
    const plan = await repos.productionRepository.create({
      planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
      items: [{ productId, plannedQuantity: qty }],
    });
    fx.ids.plans.push(plan.id);
    const conf = await repos.productionRepository.confirm(plan.id, fx.userId);
    const bon = (await repos.bonSortieRepository.findByPlan(plan.id))[0];
    if (bon) {
      await repos.bonSortieRepository.markAsPreparation(bon.id, fx.userId);
      const fresh = (await repos.bonSortieRepository.findByPlan(plan.id))[0];
      await repos.bonSortieRepository.weighLignes(bon.id, fx.userId, (fresh.lines as any[])
        .filter(l => num(l.allocated_quantity) > 0 || (l.source_location === 'ECONOMAT_REQUIRES_TRANSFER' && num(l.needed_quantity) > 0))
        .map(l => (num(l.allocated_quantity) > 0
          ? { ligneId: l.id, actualQuantity: num(l.allocated_quantity), source: 'manual' }
          : { ligneId: l.id, actualQuantity: num(l.needed_quantity), source: 'manual', lotId: l.suggested_economat_lot_id })));
      await repos.bonSortieRepository.markAsReady(bon.id, fx.userId);
      await repos.bonSortieRepository.acceptReception(bon.id, fx.userId);
    }
    await repos.productionRepository.start(plan.id, fx.userId);
    const item = (await p().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [plan.id])).rows[0].id;
    return { planId: plan.id as string, itemId: item as string, warnings: conf.warnings as string[] };
  }

  it('B — agroalimentaire conditionné : DDM, contrôle final, non-conformité, traçabilité, rappel', async () => {
    const cat = (await p().query(`INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING id`, [`Conserves B ${RUN}`, `conserves-b-${RUN}`.toLowerCase()])).rows[0].id;
    cleanup.categories.push(cat);
    const tomate = await createIngredient(fx, { name: 'Tomate B', unit: 'kg', unitCost: 3 });
    const lotMatiere = await createLot(fx, { ingredientId: tomate, lotNumber: 'TOM-B', pesage: 0, economat: 40, expiresInDays: 20, unitCost: 3 });
    const { productId } = await createProductWithRecipe(fx, { name: 'Sauce B', price: 15, ingredients: [{ ingredientId: tomate, quantity: 0.4, unit: 'kg' }] });
    await p().query(`UPDATE products SET category_id = $2, date_kind = 'ddm', prepackaged = true, shelf_life_days = 365 WHERE id = $1`, [productId, cat]);
    const qcp = (await import('../../repositories/quality-control-plan.repository.js')).qualityControlPlanRepository;
    await qcp.create({ productCategoryId: cat, stage: 'final', characteristic: 'Étanchéité du bocal', charType: 'oui_non', frequency: 'chaque_lot', isBlocking: true }, fx.userId);
    await policies.setPolicy('quality.auto_release', 'company', '', { enabled: false }, fx.userId);

    const { planId, itemId } = await runToProduced(productId, 20);
    await repos.productionRepository.produceItems(planId, [{ planItemId: itemId, actualQuantity: 20 }], fx.userId, fx.storeId);
    const lot = (await p().query(`SELECT id, status, date_kind, expires_at FROM product_lots WHERE production_plan_id = $1`, [planId])).rows[0];
    expect(lot.date_kind).toBe('ddm');
    expect(lot.status).toBe('pending_release'); // retenu par le contrôle final
    const insp = (await p().query(`SELECT id FROM quality_inspections WHERE product_lot_id = $1 AND control_stage = 'final'`, [lot.id])).rows;
    expect(insp).toHaveLength(1);

    const quality = (await import('../../repositories/quality.repository.js')).qualityRepository;
    const nc = await quality.createNonConformity({ title: `Bocal non étanche ${RUN}`, severity: 'medium', userId: fx.userId, storeId: fx.storeId, source: 'production' });
    cleanup.ncs.push(nc.id);
    expect((await p().query(`SELECT nc_number FROM quality_nonconformities WHERE id = $1`, [nc.id])).rows[0].nc_number).toMatch(/^NC-\d{4}-\d{5}$/);

    const trace = (await import('../../repositories/traceability.repository.js')).traceabilityRepository;
    const back = await trace.backward(lot.id);
    expect(JSON.stringify(back)).toContain(lotMatiere);
    const fwd = await trace.forward(lotMatiere);
    expect(JSON.stringify(fwd)).toContain(lot.id);
    const recall = await trace.createRecall({ originKind: 'ingredient_lot', originId: lotMatiere, reason: `Rappel B ${RUN}`, storeId: fx.storeId, userId: fx.userId });
    cleanup.recalls.push(recall.id);
    expect(JSON.stringify(await trace.getRecall(recall.id))).toContain(lot.id);
  });

  it('C — mécanique et assemblage : réservation, opération sur poste avec coût machine, séries', async () => {
    const on = await sectors.applyAdjustments({ features: { reservation_matiere: true } });
    expect('error' in on).toBe(false);
    await policies.setPolicy('production.cost_components', 'company', '', { emballage: true, main_oeuvre: true, machine: true, energie: true, sous_traitance: true, pertes: true, charges: true }, fx.userId);
    const acier = await createIngredient(fx, { name: 'Acier C', unit: 'kg', unitCost: 5 });
    await createLot(fx, { ingredientId: acier, lotNumber: 'ACI-C', pesage: 0, economat: 30, expiresInDays: 365, unitCost: 5 });
    const { productId } = await createProductWithRecipe(fx, { name: 'Support C', price: 80, ingredients: [{ ingredientId: acier, quantity: 2, unit: 'kg' }] });
    await p().query(`UPDATE products SET tracking_mode = 'serial' WHERE id = $1`, [productId]);
    const wc = (await p().query(`INSERT INTO work_centers (name, hourly_cost, store_id) VALUES ($1, 90, $2) RETURNING id`, [`Centre d'usinage C ${RUN}`, fx.storeId])).rows[0].id;
    cleanup.wcs.push(wc);

    const { planId, itemId, warnings } = await runToProduced(productId, 3);
    expect(warnings.join(' ')).not.toMatch(/Réservation partielle/);
    const res = (await p().query(`SELECT status, quantity::float8 AS q FROM material_reservations WHERE plan_id = $1`, [planId])).rows;
    expect(res).toEqual([{ status: 'consommee', q: 6 }]); // réservée à la confirmation, consommée au démarrage
    await p().query(
      `INSERT INTO production_item_etapes (plan_item_id, ordre, nom, status, duree_reelle_min, work_center_id) VALUES ($1, 1, 'Usinage', 'completed', 40, $2)`,
      [itemId, wc]);
    await repos.productionRepository.produceItems(planId, [{ planItemId: itemId, actualQuantity: 3 }], fx.userId, fx.storeId);
    const serials = (await import('../../repositories/product-serial.repository.js')).productSerialRepository;
    await serials.assignForPlan(planId, [{ planItemId: itemId }], fx.userId);
    const list = await serials.listForPlan(planId);
    expect(list.length).toBe(3);
    const cout = (await import('../../repositories/production-cout.repository.js')).productionCoutRepository;
    const c = await cout.calculateAndSave(planId, fx.userId);
    expect(Number(c.cout_machine)).toBe(60); // 40 min × 90 / h
    expect(Number(c.cout_matieres)).toBe(30); // 6 kg × 5
  });

  it('profils de référence : chacun se résout, ses couches sont valides, son vocabulaire est celui de son métier', async () => {
    const { cleanLayers } = await import('../../services/industry-profile.js');
    const { bakeryTermsOutsideBakery } = await import('../../services/config-health.js');
    const expected: Record<string, { ingredient: string; bakeryAllowed: boolean }> = {
      boulangerie: { ingredient: 'Ingrédient', bakeryAllowed: true },
      agro_conditionne: { ingredient: 'Ingrédient', bakeryAllowed: false },
      process: { ingredient: 'Matière première', bakeryAllowed: false },
      discret: { ingredient: 'Matière', bakeryAllowed: false },
      atelier: { ingredient: 'Matière', bakeryAllowed: false },
    };
    for (const [code, exp] of Object.entries(expected)) {
      const pack = await sectors.pack(code);
      expect(pack, code).toBeTruthy();
      expect(pack.modules.length, code).toBeGreaterThan(0);
      const labels = await sectors.labels(code);
      expect(labels.ingredient ?? 'Ingrédient', code).toBe(exp.ingredient);
      if (!exp.bakeryAllowed) expect(await bakeryTermsOutsideBakery(code), code).toEqual([]);
      const profile = await sectors.resolvedProfile(code);
      const warnings: string[] = [];
      cleanLayers(profile ?? {}, warnings);
      expect(warnings, `${code} : ${warnings.join(' ; ')}`).toEqual([]);
    }
  });
});
