import { z } from 'zod';
import { Router } from 'express';
import { ROLE_GROUPS } from '@ofauria/shared';
import { productionCoutController } from '../controllers/production-cout.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { emptyBody } from '../validators/common.validator.js';
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

export default router;
