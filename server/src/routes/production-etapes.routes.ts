import { Router } from 'express';
import { productionEtapesController } from '../controllers/production-etapes.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

// ─── Étapes ───
router.get('/plans/:planId/etapes', authenticate, asyncHandler(productionEtapesController.listByPlan));
router.get('/plans/:planId/etapes/progress', authenticate, asyncHandler(productionEtapesController.planProgress));
router.get('/items/:itemId/etapes', authenticate, asyncHandler(productionEtapesController.listByItem));
router.post('/items/:itemId/etapes/init', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionEtapesController.initialize));
router.get('/items/:itemId/etapes/check-blocking', authenticate, asyncHandler(productionEtapesController.checkBlocking));
router.put('/etapes/:etapeId/status', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionEtapesController.updateStatus));
router.post('/etapes/:etapeId/timer', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionEtapesController.startTimer));
router.post('/etapes/:etapeId/repetition', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionEtapesController.completeRepetition));

// ─── Rendement ───
router.get('/plans/:planId/rendement', authenticate, asyncHandler(productionEtapesController.planRendement));
router.post('/items/:itemId/rendement', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionEtapesController.recordRendement));
router.get('/items/:itemId/rendement/target', authenticate, asyncHandler(productionEtapesController.getRendementTarget));

// ─── Dashboard ───
router.get('/rendement/stats', authenticate, asyncHandler(productionEtapesController.rendementStats));
router.get('/rendement/by-product', authenticate, asyncHandler(productionEtapesController.rendementByProduct));

export default router;
