import { Router } from 'express';
import { packagingController } from '../controllers/packaging.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { createPackagingSchema, updatePackagingSchema, packagingAdjustStockSchema } from '../validators/stock-flow.validator.js';

const router = Router();

router.get('/', authenticate, asyncHandler(packagingController.list));
router.get('/:id', authenticate, asyncHandler(packagingController.getById));
router.get('/:id/transactions', authenticate, asyncHandler(packagingController.transactions));
router.post('/', authenticate, can('packaging.packaging_items.create'), validate(createPackagingSchema), asyncHandler(packagingController.create));
router.put('/:id', authenticate, can('packaging.packaging_items.edit'), validateUuidParams('id'), validate(updatePackagingSchema), asyncHandler(packagingController.update));
router.delete('/:id', authenticate, can('packaging.packaging_items.delete'), asyncHandler(packagingController.remove));
router.post('/:id/adjust-stock', authenticate, can('packaging.packaging_items.adjust_stock'), validateUuidParams('id'), validate(packagingAdjustStockSchema), asyncHandler(packagingController.adjustStock));

export default router;
