import { Router } from 'express';
import { ROLE_GROUPS } from '@ofauria/shared';
import { productionCoutController } from '../controllers/production-cout.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Equipements : gestion catalogue reservee admin/manager.
// Plans de production : les chefs doivent pouvoir enregistrer leur temps
// de travail, l'usage des equipements, et declencher le calcul du cout reel
// (ROLE_GROUPS.PRODUCTION couvre admin, manager, baker, pastry_chef,
// viennoiserie, beldi_sale).

// ─── Equipements CRUD ───
router.get('/equipements', authenticate, asyncHandler(productionCoutController.listEquipements));
router.get('/equipements/:id', authenticate, asyncHandler(productionCoutController.getEquipement));
router.post('/equipements', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(productionCoutController.createEquipement));
router.put('/equipements/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(productionCoutController.updateEquipement));

// ─── Temps de travail ───
router.get('/plans/:planId/temps-travail', authenticate, asyncHandler(productionCoutController.getTempsTravail));
router.post('/plans/:planId/temps-travail', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionCoutController.recordTempsTravail));

// ─── Equipement usage ───
router.get('/plans/:planId/equipement-usage', authenticate, asyncHandler(productionCoutController.getEquipementUsage));
router.post('/plans/:planId/equipement-usage', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionCoutController.recordEquipementUsage));

// ─── Cost calculation ───
// Chefs autorises a calculer et recalculer le cout de leur plan.
router.post('/plans/:planId/calculate', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionCoutController.calculateCost));
router.get('/plans/:planId/cout', authenticate, asyncHandler(productionCoutController.getCost));

// ─── Dashboard ───
router.get('/stats', authenticate, asyncHandler(productionCoutController.costStats));
router.get('/by-day', authenticate, asyncHandler(productionCoutController.costByDay));

export default router;
