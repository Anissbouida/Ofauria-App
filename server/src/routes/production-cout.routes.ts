import { Router } from 'express';
import { productionCoutController } from '../controllers/production-cout.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// ─── Equipements CRUD ───
router.get('/equipements', authenticate, asyncHandler(productionCoutController.listEquipements));
router.get('/equipements/:id', authenticate, asyncHandler(productionCoutController.getEquipement));
router.post('/equipements', authenticate, authorize('admin', 'manager'), asyncHandler(productionCoutController.createEquipement));
router.put('/equipements/:id', authenticate, authorize('admin', 'manager'), asyncHandler(productionCoutController.updateEquipement));

// ─── Temps de travail ───
router.get('/plans/:planId/temps-travail', authenticate, asyncHandler(productionCoutController.getTempsTravail));
router.post('/plans/:planId/temps-travail', authenticate, authorize('admin', 'manager'), asyncHandler(productionCoutController.recordTempsTravail));

// ─── Equipement usage ───
router.get('/plans/:planId/equipement-usage', authenticate, asyncHandler(productionCoutController.getEquipementUsage));
router.post('/plans/:planId/equipement-usage', authenticate, authorize('admin', 'manager'), asyncHandler(productionCoutController.recordEquipementUsage));

// ─── Cost calculation ───
router.post('/plans/:planId/calculate', authenticate, authorize('admin', 'manager'), asyncHandler(productionCoutController.calculateCost));
router.get('/plans/:planId/cout', authenticate, asyncHandler(productionCoutController.getCost));

// ─── Dashboard ───
router.get('/stats', authenticate, asyncHandler(productionCoutController.costStats));
router.get('/by-day', authenticate, asyncHandler(productionCoutController.costByDay));

export default router;
