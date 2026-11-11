import { Router } from 'express';
import { ROLE_GROUPS } from '@ofauria/shared';
import { productTransferController } from '../controllers/product-transfer.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

// Transferts de produits finis entre sites (phase 7.4) — direction.
const router = Router();
const staff = [authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER)];
router.get('/', ...staff, asyncHandler(productTransferController.list));
router.get('/:id', ...staff, asyncHandler(productTransferController.get));
router.post('/', ...staff, asyncHandler(productTransferController.create));
export default router;
