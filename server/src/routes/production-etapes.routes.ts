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

// ─── Relevés de procédé par fournée (mig 422) — épic labo L2 ───
router.post('/etapes/:etapeId/readings', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionEtapesController.addReading));
router.delete('/readings/:readingId', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionEtapesController.deleteReading));

// ─── Rétro-planning par temps de procédé (mig 432) — épic labo L6 ───
router.post('/plans/:planId/retro-planning', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionEtapesController.computeRetroPlanning));

// ─── Exécution d'atelier (mig 399) — roadmap lot 4 ───
router.put('/etapes/:etapeId/assign', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionEtapesController.assignEtape));
router.post('/etapes/:etapeId/pause', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionEtapesController.pauseEtape));
router.post('/etapes/:etapeId/resume', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionEtapesController.resumeEtape));
router.get('/atelier/live', authenticate, asyncHandler(productionEtapesController.atelierLive));

// ─── Rendement ───
router.get('/plans/:planId/rendement', authenticate, asyncHandler(productionEtapesController.planRendement));
router.post('/items/:itemId/rendement', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionEtapesController.recordRendement));
router.get('/items/:itemId/rendement/target', authenticate, asyncHandler(productionEtapesController.getRendementTarget));

// ─── Dashboard ───
router.get('/rendement/stats', authenticate, asyncHandler(productionEtapesController.rendementStats));
router.get('/rendement/by-product', authenticate, asyncHandler(productionEtapesController.rendementByProduct));

export default router;
