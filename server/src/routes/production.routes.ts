import { Router } from 'express';
import { productionController } from '../controllers/production.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS } from '@ofauria/shared';
import { validate, validateQuery, validateUuidParams } from '../middleware/validate.middleware.js';
import {
  createPlanSchema, updateItemsSchema, itemIdsSchema, startItemsSchema, produceItemsSchema,
  completeSchema, cancelItemsSchema, relaunchSchema, addActivitySchema, requestStockVerificationSchema, listQuerySchema,
} from '../validators/production.validator.js';

const id = validateUuidParams('id');

const router = Router();

router.get('/', authenticate, validateQuery(listQuerySchema), asyncHandler(productionController.list));
// Static routes BEFORE /:id to avoid capture
router.get('/transfers/pending', authenticate, asyncHandler(productionController.pendingProductionTransfers));

// MRP — besoins nets du jour (plan directeur). Avant /:id pour ne pas être capturé comme id.
router.get('/mrp', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionController.mrp));
router.post('/transfers/:transferId/receive', authenticate, validateUuidParams('transferId'), authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionController.confirmProductionTransfer));

router.get('/:id/sub-recipe-analysis', authenticate, id, asyncHandler(productionController.analyzeSubRecipes));
router.get('/:id', authenticate, id, asyncHandler(productionController.getById));
router.post('/', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), validate(createPlanSchema), asyncHandler(productionController.create));
router.put('/:id/items', authenticate, id, authorize(...ROLE_GROUPS.PRODUCTION), validate(updateItemsSchema), asyncHandler(productionController.updateItems));
router.post('/:id/confirm', authenticate, id, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionController.confirm));
router.post('/:id/revert-to-draft', authenticate, id, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionController.revertToDraft));
router.post('/:id/relaunch', authenticate, id, authorize(...ROLE_GROUPS.PRODUCTION), validate(relaunchSchema), asyncHandler(productionController.relaunch));
router.post('/:id/start', authenticate, id, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionController.start));
router.post('/:id/start-items', authenticate, id, authorize(...ROLE_GROUPS.PRODUCTION), validate(startItemsSchema), asyncHandler(productionController.startItems));
router.post('/:id/produce-items', authenticate, id, authorize(...ROLE_GROUPS.PRODUCTION), validate(produceItemsSchema), asyncHandler(productionController.produceItems));
router.post('/:id/transfer-items', authenticate, id, authorize(...ROLE_GROUPS.PRODUCTION), validate(itemIdsSchema), asyncHandler(productionController.transferItems));
router.post('/:id/restore-items', authenticate, id, authorize(...ROLE_GROUPS.PRODUCTION), validate(itemIdsSchema), asyncHandler(productionController.restoreItems));
router.post('/:id/needs/:ingredientId/request-verification', authenticate, validateUuidParams('id', 'ingredientId'), authorize(...ROLE_GROUPS.PRODUCTION), validate(requestStockVerificationSchema), asyncHandler(productionController.requestStockVerification));
router.post('/:id/cancel-items', authenticate, id, authorize(...ROLE_GROUPS.PRODUCTION), validate(cancelItemsSchema), asyncHandler(productionController.cancelItems));
router.post('/:id/complete', authenticate, id, authorize(...ROLE_GROUPS.PRODUCTION), validate(completeSchema), asyncHandler(productionController.complete));
router.post('/:id/detect-semi-finished', authenticate, id, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionController.detectSemiFinished));
router.get('/:id/dependencies', authenticate, id, asyncHandler(productionController.getPlanDependencies));
router.get('/:id/activities', authenticate, id, asyncHandler(productionController.getActivities));
// Journal des transitions (plan + bons) — mig 299
router.get('/:id/events', authenticate, id, asyncHandler(productionController.getEvents));
router.post('/:id/activities', authenticate, id, authorize(...ROLE_GROUPS.PRODUCTION), validate(addActivitySchema), asyncHandler(productionController.addActivity));
router.delete('/:id', authenticate, id, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(productionController.remove));

export default router;
