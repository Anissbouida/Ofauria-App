import { Router } from 'express';
import { packagingController } from '../controllers/packaging.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.get('/', authenticate, asyncHandler(packagingController.list));
router.get('/:id', authenticate, asyncHandler(packagingController.getById));
router.get('/:id/transactions', authenticate, asyncHandler(packagingController.transactions));
router.post('/', authenticate, can('packaging.packaging_items.create'), asyncHandler(packagingController.create));
router.put('/:id', authenticate, can('packaging.packaging_items.edit'), asyncHandler(packagingController.update));
router.delete('/:id', authenticate, can('packaging.packaging_items.delete'), asyncHandler(packagingController.remove));
router.post('/:id/adjust-stock', authenticate, can('packaging.packaging_items.adjust_stock'), asyncHandler(packagingController.adjustStock));

export default router;
