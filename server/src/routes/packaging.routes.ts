import { Router } from 'express';
import { packagingController } from '../controllers/packaging.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

router.get('/', authenticate, asyncHandler(packagingController.list));
router.get('/:id', authenticate, asyncHandler(packagingController.getById));
router.get('/:id/transactions', authenticate, asyncHandler(packagingController.transactions));
router.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(packagingController.create));
router.put('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(packagingController.update));
router.delete('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(packagingController.remove));
router.post('/:id/adjust-stock', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER, 'magasinier'), asyncHandler(packagingController.adjustStock));

export default router;
