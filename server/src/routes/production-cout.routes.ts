import { z } from 'zod';
import { Router } from 'express';
import { ROLE_GROUPS } from '@ofauria/shared';
import { productionCoutController } from '../controllers/production-cout.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { emptyBody } from '../validators/common.validator.js';
import { analyticCostRepository, AnalyticError } from '../repositories/analytic-cost.repository.js';
import { standardCost, suggestedPrice } from '../services/cost-engine.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import type { Response } from 'express';
import { createEquipementBody, updateEquipementBody, recordTempsTravailBody, recordEquipementUsageBody } from '../validators/production-flow.validator.js';

const router = Router();
const costSharesSchema = z.object({ shares: z.array(z.object({ planItemId: z.string().guid(), pct: z.number().min(0).max(100).nullable() })).min(1).max(500) });

// Equipements : gestion catalogue reservee admin/manager.
// Plans de production : les chefs doivent pouvoir enregistrer leur temps
// de travail, l'usage des equipements, et declencher le calcul du cout reel
// (ROLE_GROUPS.PRODUCTION couvre admin, manager, baker, pastry_chef,
// viennoiserie, beldi_sale).

// ─── Equipements CRUD ───
router.get('/equipements', authenticate, can('production.production_cout.view'), asyncHandler(productionCoutController.listEquipements));
router.get('/equipements/:id', authenticate, can('production.production_cout.view'), asyncHandler(productionCoutController.getEquipement));
router.post('/equipements', authenticate, can('production.production_cout.equipements'), validate(createEquipementBody), asyncHandler(productionCoutController.createEquipement));
router.put('/equipements/:id', authenticate, validateUuidParams('id'), can('production.production_cout.equipements'), validate(updateEquipementBody), asyncHandler(productionCoutController.updateEquipement));

// ─── Temps de travail ───
router.get('/plans/:planId/temps-travail', authenticate, can('production.production_cout.view'), asyncHandler(productionCoutController.getTempsTravail));
router.post('/plans/:planId/temps-travail', authenticate, validateUuidParams('planId'), can('production.production_cout.temps_travail'), validate(recordTempsTravailBody), asyncHandler(productionCoutController.recordTempsTravail));

// ─── Equipement usage ───
router.get('/plans/:planId/equipement-usage', authenticate, can('production.production_cout.view'), asyncHandler(productionCoutController.getEquipementUsage));
router.post('/plans/:planId/equipement-usage', authenticate, validateUuidParams('planId'), can('production.production_cout.equipement_usage'), validate(recordEquipementUsageBody), asyncHandler(productionCoutController.recordEquipementUsage));

// ─── Cost calculation ───
// Chefs autorises a calculer et recalculer le cout de leur plan.
router.get('/plans/:planId/allocation', authenticate, validateUuidParams('planId'), can('production.production_cout.view'), asyncHandler(productionCoutController.getAllocation));
router.put('/plans/:planId/cost-shares', authenticate, validateUuidParams('planId'), can('production.production_cout.calculate'), validate(costSharesSchema), asyncHandler(productionCoutController.setCostShares));
router.post('/plans/:planId/calculate', authenticate, validateUuidParams('planId'), can('production.production_cout.calculate'), validate(emptyBody), asyncHandler(productionCoutController.calculateCost));
router.get('/plans/:planId/cout', authenticate, can('production.production_cout.view'), asyncHandler(productionCoutController.getCost));

// ─── Dashboard ───
router.get('/stats', authenticate, can('production.production_cout.view'), asyncHandler(productionCoutController.costStats));
router.get('/by-day', authenticate, can('production.production_cout.view'), asyncHandler(productionCoutController.costByDay));
router.get('/by-product', authenticate, can('production.production_cout.view'), asyncHandler(productionCoutController.costByProduct));
router.get('/plans-with-cost', authenticate, can('production.production_cout.view'), asyncHandler(productionCoutController.plansWithCost));
router.post('/batch-calculate', authenticate, can('production.production_cout.batch_calculate'), validate(emptyBody), asyncHandler(productionCoutController.batchCalculate));

// ─── Ecart MO standard (gamme mig 388) vs reel (etapes mig 089) — roadmap lot 1 ───
router.get('/plans/:planId/mo-ecart', authenticate, can('production.production_cout.view'), asyncHandler(productionCoutController.getMoEcartByPlan));
router.get('/by-product/mo-ecart', authenticate, can('production.production_cout.view'), asyncHandler(productionCoutController.getMoEcartByProduct));

// ─── Cout de revient par sortie de coupe (mig 302/397) — roadmap lot 2 ───
router.get('/plans/:planId/outputs-cost', authenticate, can('production.production_cout.view'), asyncHandler(productionCoutController.getOutputCostByPlan));

// ─── Charge par poste vs capacite (mig 398) — roadmap lot 3 ───
router.get('/plans/:planId/charge', authenticate, can('production.production_cout.view'), asyncHandler(productionCoutController.getChargeByPlan));

// ─── Comptabilité analytique du coût de revient (mig 655) ───
// Paramétrage et rapport de période : gérant (les coûts salariaux y sont visibles).
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const A = 'production.production_cout.analytique' as const;
const store = (req: AuthRequest) => (typeof req.query.storeId === 'string' && z.string().guid().safeParse(req.query.storeId).success
  ? req.query.storeId : req.user!.storeId) ?? null;
const monthOf = (req: AuthRequest) => {
  const m = typeof req.query.month === 'string' ? req.query.month : (req.body?.month as string | undefined);
  if (m && MONTH.test(m)) return m;
  const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const run = (fn: (req: AuthRequest, res: Response) => Promise<unknown>, status = 200) => asyncHandler(async (req: AuthRequest, res: Response) => {
  try { res.status(status).json({ success: true, data: await fn(req, res) }); }
  catch (e) {
    if (e instanceof AnalyticError) { res.status(400).json({ success: false, error: { message: e.message } }); return; }
    throw e;
  }
});
const DRIVER = z.enum(['units', 'weight_kg', 'labour_hours', 'machine_hours', 'batches', 'material_cost', 'sales_value']);
const LEVEL = z.enum(['approvisionnement', 'production', 'administration', 'distribution']);
const centreCreate = z.object({ code: z.string().trim().min(1).max(20), name: z.string().trim().min(1).max(120),
  kind: z.enum(['principal', 'auxiliaire']), level: LEVEL, driver: DRIVER, parentId: z.string().guid().nullable().optional() });
const centreUpdate = z.object({ name: z.string().trim().min(1).max(120).optional(), kind: z.enum(['principal', 'auxiliaire']).optional(),
  level: LEVEL.optional(), driver: DRIVER.optional(), parentId: z.string().guid().nullable().optional(),
  normalCapacity: z.number().positive().max(1e12).nullable().optional(), maxCapacity: z.number().positive().max(1e12).nullable().optional(),
  transferBasis: z.enum(['percent', 'headcount', 'payroll']).optional(), isActive: z.boolean().optional(),
  description: z.string().max(2000).nullable().optional(),
  transfers: z.array(z.object({ toId: z.string().guid(), percent: z.number().min(0).max(100) })).max(50).optional() });
const chargeBody = z.object({ label: z.string().trim().min(1).max(160),
  nature: z.enum(['loyer', 'assurance', 'abonnement', 'amortissement', 'salaires', 'energie', 'eau', 'maintenance', 'informatique',
    'securite', 'administratif', 'honoraires', 'transport', 'marketing', 'sous_traitance', 'consommables', 'taxes', 'autre']),
  behavior: z.enum(['fixed', 'variable', 'semi_variable']), fixedPct: z.number().min(0).max(100).default(100),
  assignment: z.enum(['direct', 'indirect']), costCenterId: z.string().guid().nullable().optional(),
  allocationKeyId: z.string().guid().nullable().optional(), productId: z.string().guid().nullable().optional(),
  normalQuantity: z.number().positive().max(1e12).nullable().optional(), monthlyAmount: z.number().min(0).max(1e11),
  notes: z.string().max(2000).nullable().optional(), isActive: z.boolean().optional(),
  accountIds: z.array(z.string().guid()).max(30).optional() });
const keyBody = z.object({ name: z.string().trim().min(1).max(120),
  lines: z.array(z.object({ centerId: z.string().guid(), percent: z.number().positive().max(100) })).min(1).max(50) });
const allocBody = z.object({ allocations: z.array(z.object({ centerId: z.string().guid(), percent: z.number().positive().max(100),
  laborType: z.enum(['direct', 'indirect']) })).max(20) });

router.get('/analytique/meta', authenticate, can(A), run(async () => ({ ...analyticCostRepository.meta(), method: await analyticCostRepository.method() })));
router.put('/analytique/methode', authenticate, can(A), validate(z.object({ method: z.enum(['rate', 'analytic']) })),
  run(async (req) => analyticCostRepository.setMethod(req.body.method)));
router.get('/analytique/periode', authenticate, can(A), run(async (req) => analyticCostRepository.period(store(req), monthOf(req))));
router.post('/analytique/recalculer', authenticate, can(A), validate(z.object({ month: z.string().regex(MONTH) })),
  run(async (req) => analyticCostRepository.recalcMonth(store(req), req.body.month, req.user!.userId)));
router.post('/analytique/cloturer', authenticate, can(A), validate(z.object({ month: z.string().regex(MONTH) })),
  run(async (req) => analyticCostRepository.closeMonth(store(req), req.body.month, req.user!.userId)));
router.post('/analytique/rouvrir', authenticate, can(A),
  validate(z.object({ month: z.string().regex(MONTH), reason: z.string().trim().min(3).max(500) })),
  run(async (req) => analyticCostRepository.reopenMonth(store(req), req.body.month, req.user!.userId, req.body.reason)));
router.get('/analytique/centres', authenticate, can(A), run(async (req) => analyticCostRepository.centres(store(req))));
router.post('/analytique/centres', authenticate, can(A), validate(centreCreate),
  run(async (req) => analyticCostRepository.createCentre({ ...req.body, storeId: null, userId: req.user!.userId }), 201));
router.put('/analytique/centres/:id', authenticate, validateUuidParams('id'), can(A), validate(centreUpdate),
  run(async (req) => analyticCostRepository.updateCentre(req.params.id as string, req.body)));
router.get('/analytique/cles', authenticate, can(A), run(async () => analyticCostRepository.keys()));
router.post('/analytique/cles', authenticate, can(A), validate(keyBody),
  run(async (req) => analyticCostRepository.saveKey(null, { ...req.body, userId: req.user!.userId }), 201));
router.put('/analytique/cles/:id', authenticate, validateUuidParams('id'), can(A), validate(keyBody),
  run(async (req) => analyticCostRepository.saveKey(req.params.id as string, { ...req.body, userId: req.user!.userId })));
router.get('/analytique/charges', authenticate, can(A), run(async (req) => analyticCostRepository.charges(store(req), monthOf(req))));
router.post('/analytique/charges', authenticate, can(A), validate(chargeBody),
  run(async (req) => analyticCostRepository.createCharge({ ...req.body, storeId: null, userId: req.user!.userId }), 201));
router.put('/analytique/charges/:id', authenticate, validateUuidParams('id'), can(A), validate(chargeBody),
  run(async (req) => analyticCostRepository.updateCharge(req.params.id as string, req.body)));
router.put('/analytique/charges/:id/actif', authenticate, validateUuidParams('id'), can(A), validate(z.object({ active: z.boolean() })),
  run(async (req) => analyticCostRepository.setChargeActive(req.params.id as string, req.body.active)));
router.put('/analytique/charges/:id/reel', authenticate, validateUuidParams('id'), can(A),
  validate(z.object({ month: z.string().regex(MONTH), amount: z.number().min(0).max(1e11).nullable() })),
  run(async (req) => analyticCostRepository.setActual(req.params.id as string, req.body.month, req.body.amount, req.user!.userId, store(req))));
// Lot E : coût standard d'une fiche (mêmes charges que le coût réel) et prix conseillé.
router.get('/analytique/fiche/:recipeId', authenticate, validateUuidParams('recipeId'), can('production.production_cout.view'),
  run(async (req) => {
    const formatId = typeof req.query.formatId === 'string' && z.string().guid().safeParse(req.query.formatId).success ? req.query.formatId : null;
    const target = Number(req.query.marque);
    const s = await standardCost(req.params.recipeId as string, { formatId, storeId: store(req) });
    if (!s) throw new AnalyticError('Fiche introuvable');
    const marque = Number.isFinite(target) && target > 0 && target < 95 ? target : 30;
    return { ...s, cibleMarque: marque, prixConseille: suggestedPrice(s, marque) };
  }));
router.get('/analytique/rentabilite', authenticate, can(A), run(async (req) => {
  const to = monthOf(req);
  const from = typeof req.query.from === 'string' && MONTH.test(req.query.from) && req.query.from <= to ? req.query.from : to;
  return analyticCostRepository.profitability(store(req), from, to);
}));
router.get('/analytique/comptes', authenticate, can(A), run(async () => analyticCostRepository.expenseAccounts()));
router.get('/analytique/rapprochement', authenticate, can(A), run(async (req) => analyticCostRepository.reconciliation(store(req), monthOf(req))));
router.get('/analytique/personnel', authenticate, can(A), run(async (req) => analyticCostRepository.personnel(store(req), monthOf(req))));
router.put('/analytique/personnel/:id', authenticate, validateUuidParams('id'), can(A), validate(allocBody),
  run(async (req) => analyticCostRepository.setAllocations(req.params.id as string, req.body.allocations)));

export default router;
