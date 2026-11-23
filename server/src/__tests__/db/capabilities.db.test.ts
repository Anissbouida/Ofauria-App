/**
 * Catalogue de capacités (plan d'exécution multi-industries, étape 1, mig 632).
 *
 *   - Le socle (capacités default_on) est actif sans figurer dans le préréglage : la
 *     boulangerie garde exactement ses options, et gagne les capacités du socle.
 *   - Activer une capacité active ses dépendances ; désactiver une capacité dont d'autres
 *     dépendent est refusé tant que celles-ci restent actives.
 *   - Une capacité réglementaire utilisée par des données ne se désactive pas.
 *   - Garde d'API : une capacité éteinte ferme ses routes (403 FEATURE_DISABLED).
 *   - production.enforce_declared_steps : « pesée obligatoire » au démarrage et
 *     « contrôle obligatoire » au transfert, seulement quand la politique est active.
 */
process.env.POS_ALLOW_NEGATIVE_STOCK = 'off';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  hasTestDb, testPool, closeTestPool, importRepositories,
  createBaseFixtures, createIngredient, createLot, createProductWithRecipe, cleanupFixtures,
  type Fixtures,
} from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

describe.skipIf(!hasTestDb)('Catalogue de capacités', () => {
  let sectors: typeof import('../../repositories/sector.repository.js').sectorRepository;
  let repos: Awaited<ReturnType<typeof importRepositories>>;
  let initialSector = 'boulangerie';

  beforeAll(async () => {
    repos = await importRepositories();
    sectors = (await import('../../repositories/sector.repository.js')).sectorRepository;
    initialSector = (await sectors.current()).code;
    await sectors.setSector('boulangerie', { keepAdjustments: false });
  }, 60_000);

  afterAll(async () => {
    await sectors.resetAdjustments().catch(() => undefined);
    await sectors.setSector(initialSector, { keepAdjustments: false }).catch(() => undefined);
    await repos?.db.pool.end().catch(() => undefined);
    await closeTestPool();
  });

  it('le socle est actif sans figurer dans le préréglage ; les options boulangerie sont inchangées', async () => {
    const act = await sectors.activation();
    for (const k of ['lots', 'dlc_ddm', 'allergenes', 'tracabilite', 'pesage', 'controle_qualite', 'sous_traitance', 'series']) {
      expect(act.features.has(k)).toBe(true);
    }
    for (const k of ['dlc_jour', 'vitrine', 'contenants_cru_cuit', 'ccp_cuisson', 'haccp', 'lot_thermal', 'fiche_masterclass', 'mode_fournee']) {
      expect(act.features.has(k)).toBe(true);
    }
    // Annoncées mais pas encore construites : éteintes par défaut.
    expect(act.features.has('reservation_matiere')).toBe(false);
    expect(act.features.has('conditionnement')).toBe(false);
    expect(Object.keys(act.featureOverrides)).toEqual([]);
    const lots = act.catalog.find(f => f.key === 'lots')!;
    expect(lots.kind).toBe('reglementaire');
    expect(act.catalog.find(f => f.key === 'rappel')!.requires).toEqual(['tracabilite']);
  });

  it('désactiver une capacité dont une autre dépend est refusé tant que la dépendante reste active', async () => {
    const r = await sectors.planAdjustments({ features: { tracabilite: false } });
    expect('error' in r && r.error).toMatch(/Rappel de lot/);
    const ok = await sectors.applyAdjustments({ features: { tracabilite: false, rappel: false } });
    expect('error' in ok).toBe(false);
    const act = await sectors.activation();
    expect(act.features.has('tracabilite')).toBe(false);
    expect(act.features.has('rappel')).toBe(false);
    expect(act.featureOverrides).toEqual({ tracabilite: false, rappel: false });
  });

  it('activer une capacité active ses dépendances (Rappel → Traçabilité)', async () => {
    const r = await sectors.applyAdjustments({ features: { rappel: true } });
    expect('error' in r).toBe(false);
    const act = await sectors.activation();
    expect(act.features.has('rappel')).toBe(true);
    expect(act.features.has('tracabilite')).toBe(true);
    expect(act.featureOverrides).toEqual({}); // retour au socle : plus aucun écart
  });

  it('une capacité réglementaire utilisée ne se désactive pas', async () => {
    const fx = await createBaseFixtures();
    try {
      const ing = await createIngredient(fx, { name: 'Farine cap', unit: 'kg', unitCost: 5 });
      await createLot(fx, { ingredientId: ing, lotNumber: 'CAP', pesage: 1, expiresInDays: 30 });
      const r = await sectors.planAdjustments({
        features: { lots: false, dlc_ddm: false, dlc_jour: false, vitrine: false, lot_thermal: false, tracabilite: false, rappel: false,
          pesage: false, controle_qualite: false, quarantaine: false, reservation_matiere: false },
      });
      expect('error' in r && r.error).toMatch(/réglementaire utilisée/);
    } finally {
      await cleanupFixtures(fx);
    }
  });

  it('une capacité éteinte ferme ses routes (garde d\'API)', async () => {
    const { moduleActivationGuard } = await import('../../middleware/module-activation.middleware.js');
    const run = async (path: string) => {
      let status = 200; let code: string | undefined; let nexted = false;
      const res: any = { status(s: number) { status = s; return this; }, json(b: any) { code = b?.error?.code; return this; } };
      await moduleActivationGuard({ method: 'GET', path, headers: {} } as any, res, () => { nexted = true; });
      return { status: nexted ? 200 : status, code };
    };
    expect((await run('/production/subcontracting')).status).toBe(200);
    await sectors.applyAdjustments({ features: { sous_traitance: false } });
    const closed = await run('/production/subcontracting');
    expect(closed.status).toBe(403);
    expect(closed.code).toBe('FEATURE_DISABLED');
    expect((await run('/production/0b5c1c7e-0000-4000-8000-000000000000/subcontract')).status).toBe(403);
    // Une autre route de production reste ouverte.
    expect((await run('/production/0b5c1c7e-0000-4000-8000-000000000000')).status).toBe(200);
    await sectors.applyAdjustments({ features: { sous_traitance: null } });
    expect((await run('/production/subcontracting')).status).toBe(200);
  });

  describe('Étapes obligatoires des types d\'ordre (production.enforce_declared_steps)', () => {
    let fx: Fixtures; let productId: string; let farineId: string;
    let setPolicy: typeof import('../../services/policies.js').setPolicy;

    beforeAll(async () => {
      setPolicy = (await import('../../services/policies.js')).setPolicy;
      // Indépendant de l'ordre des fichiers : un profil de référence chargé ailleurs pose cette politique.
      await testPool().query(`DELETE FROM policy_values WHERE key = 'production.enforce_declared_steps'`);
      (await import('../../services/policies.js')).invalidatePolicies();
      fx = await createBaseFixtures();
      farineId = await createIngredient(fx, { name: 'Farine oblig', unit: 'kg', unitCost: 10 });
      await createLot(fx, { ingredientId: farineId, lotNumber: 'OBL', pesage: 100, expiresInDays: 30, unitCost: 10 });
      productId = (await createProductWithRecipe(fx, { name: 'Pain oblig', price: 2, ingredients: [{ ingredientId: farineId, quantity: 0.5, unit: 'kg' }] })).productId;
    }, 60_000);

    afterAll(async () => {
      await testPool().query(`DELETE FROM policy_values WHERE key = 'production.enforce_declared_steps'`).catch(() => undefined);
      (await import('../../services/policies.js')).invalidatePolicies();
      await testPool().query(`UPDATE production_order_types SET requires_quality_check = false WHERE is_default`).catch(() => undefined);
      await testPool().query(`DELETE FROM quality_inspections WHERE plan_id = ANY($1)`, [fx.ids.plans]).catch(() => undefined);
      await testPool().query(`DELETE FROM production_transfer_items WHERE transfer_id IN (SELECT id FROM production_transfers WHERE plan_id = ANY($1))`, [fx.ids.plans]).catch(() => undefined);
      await testPool().query(`DELETE FROM production_transfers WHERE plan_id = ANY($1)`, [fx.ids.plans]).catch(() => undefined);
      if (fx) await cleanupFixtures(fx);
    });

    async function planThroughBsi(qty: number) {
      const plan = await repos.productionRepository.create({
        planDate: new Date().toISOString().slice(0, 10), type: 'daily', createdBy: fx.userId, storeId: fx.storeId,
        items: [{ productId, plannedQuantity: qty }],
      });
      fx.ids.plans.push(plan.id);
      await repos.productionRepository.confirm(plan.id, fx.userId);
      const bon = (await repos.bonSortieRepository.findByPlan(plan.id))[0];
      await repos.bonSortieRepository.markAsPreparation(bon.id, fx.userId);
      const fresh = (await repos.bonSortieRepository.findByPlan(plan.id))[0];
      await repos.bonSortieRepository.weighLignes(bon.id, fx.userId, (fresh.lines as any[])
        .filter(l => Number(l.allocated_quantity) > 0)
        .map(l => ({ ligneId: l.id, actualQuantity: Number(l.allocated_quantity), source: 'manual' })));
      await repos.bonSortieRepository.markAsReady(bon.id, fx.userId);
      await repos.bonSortieRepository.acceptReception(bon.id, fx.userId);
      const item = (await testPool().query(`SELECT id FROM production_plan_items WHERE plan_id = $1`, [plan.id])).rows[0].id as string;
      return { planId: plan.id as string, bonId: bon.id as string, itemId: item };
    }

    it('politique éteinte (défaut) : une ligne non pesée ne bloque pas le démarrage', async () => {
      const { planId, bonId } = await planThroughBsi(2);
      await testPool().query(`UPDATE production_bons_sortie_lignes SET weighed_at = NULL WHERE bon_id = $1`, [bonId]);
      await expect(repos.productionRepository.start(planId, fx.userId)).resolves.toBeUndefined();
    });

    it('politique active : la pesée obligatoire du type d\'ordre bloque le démarrage', async () => {
      await setPolicy('production.enforce_declared_steps', 'company', '', { enabled: true }, fx.userId);
      const { planId, bonId } = await planThroughBsi(2);
      await testPool().query(`UPDATE production_bons_sortie_lignes SET weighed_at = NULL WHERE bon_id = $1`, [bonId]);
      await expect(repos.productionRepository.start(planId, fx.userId)).rejects.toThrow(/Pesée obligatoire/);
      await testPool().query(`UPDATE production_bons_sortie_lignes SET weighed_at = NOW() WHERE bon_id = $1`, [bonId]);
      await expect(repos.productionRepository.start(planId, fx.userId)).resolves.toBeUndefined();
    });

    it('politique active : le contrôle obligatoire bloque le transfert tant qu\'aucun contrôle conforme n\'existe', async () => {
      await testPool().query(`UPDATE production_order_types SET requires_quality_check = true WHERE is_default`);
      const { planId, itemId } = await planThroughBsi(2);
      await repos.productionRepository.start(planId, fx.userId);
      await repos.productionRepository.produceItems(planId, [{ planItemId: itemId, actualQuantity: 2 }], fx.userId, fx.storeId);
      await testPool().query(`DELETE FROM quality_inspections WHERE plan_id = $1`, [planId]);
      await expect(repos.productionRepository.createTransfer(planId, [itemId], fx.userId, fx.storeId)).rejects.toThrow(/Contrôle qualité obligatoire/);
      await testPool().query(
        `INSERT INTO quality_inspections (template_name, title, inspected_on, results, conformity, plan_id, status)
         VALUES ('Contrôle final', 'Contrôle final', CURRENT_DATE, '[]'::jsonb, true, $1, 'faite')`, [planId]);
      await expect(repos.productionRepository.createTransfer(planId, [itemId], fx.userId, fx.storeId)).resolves.toBeTruthy();
    });
  });
});
