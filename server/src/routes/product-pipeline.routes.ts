import { Router } from 'express';
import { productPipelineController } from '../controllers/product-pipeline.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
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
router.post('/', can('products.product_pipeline.create'), asyncHandler(productPipelineController.create));

// Update stage data (admin/manager)
router.put('/:id/stage-data', can('products.product_pipeline.stage_data'), asyncHandler(productPipelineController.updateStageData));

// Advance to next stage (admin/manager)
router.post('/:id/advance', can('products.product_pipeline.advance'), asyncHandler(productPipelineController.advanceStage));

// Admin decision (admin only for final validation)
router.post('/:id/admin-decision', can('products.product_pipeline.admin_decision'), asyncHandler(productPipelineController.adminDecision));

// Integrate into catalog (admin only)
router.post('/:id/integrate', can('products.product_pipeline.integrate'), asyncHandler(productPipelineController.integrateCatalog));

// Cancel pipeline (admin/manager)
router.post('/:id/cancel', can('products.product_pipeline.cancel'), asyncHandler(productPipelineController.cancel));

export default router;
