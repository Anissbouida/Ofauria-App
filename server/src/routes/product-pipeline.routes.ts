import { Router } from 'express';
import { productPipelineController } from '../controllers/product-pipeline.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// List & stats
router.get('/', asyncHandler(productPipelineController.list));
router.get('/stats', asyncHandler(productPipelineController.stats));

// Single pipeline
router.get('/:id', asyncHandler(productPipelineController.getById));
router.get('/:id/history', asyncHandler(productPipelineController.getHistory));

// Create (admin/manager)
router.post('/', authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(productPipelineController.create));

// Update stage data (admin/manager)
router.put('/:id/stage-data', authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(productPipelineController.updateStageData));

// Advance to next stage (admin/manager)
router.post('/:id/advance', authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(productPipelineController.advanceStage));

// Admin decision (admin only for final validation)
router.post('/:id/admin-decision', authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(productPipelineController.adminDecision));

// Integrate into catalog (admin only)
router.post('/:id/integrate', authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(productPipelineController.integrateCatalog));

// Cancel pipeline (admin/manager)
router.post('/:id/cancel', authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(productPipelineController.cancel));

export default router;
