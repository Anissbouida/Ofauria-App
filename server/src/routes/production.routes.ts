import { Router } from 'express';
import { productionController } from '../controllers/production.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

router.get('/', authenticate, asyncHandler(productionController.list));
// Static routes BEFORE /:id to avoid capture
router.get('/transfers/pending', authenticate, asyncHandler(productionController.pendingProductionTransfers));
router.post('/transfers/:transferId/receive', authenticate, asyncHandler(productionController.confirmProductionTransfer));

router.get('/:id/sub-recipe-analysis', authenticate, asyncHandler(productionController.analyzeSubRecipes));
router.get('/:id', authenticate, asyncHandler(productionController.getById));
router.post('/', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionController.create));
router.put('/:id/items', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionController.updateItems));
router.post('/:id/confirm', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionController.confirm));
router.post('/:id/start', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionController.start));
router.post('/:id/start-items', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionController.startItems));
router.post('/:id/produce-items', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionController.produceItems));
router.post('/:id/transfer-items', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionController.transferItems));
router.post('/:id/restore-items', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionController.restoreItems));
router.post('/:id/cancel-items', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionController.cancelItems));
router.post('/:id/complete', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionController.complete));
router.delete('/:id', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionController.remove));

export default router;
