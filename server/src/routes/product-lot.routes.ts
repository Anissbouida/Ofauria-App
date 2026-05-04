import { Router } from 'express';
import { productLotController } from '../controllers/product-lot.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

router.get('/expired-active', authenticate, asyncHandler(productLotController.expiredActive));
router.post('/send-orphan-to-losses',
  authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER),
  asyncHandler(productLotController.sendOrphanToLosses));
router.post('/:id/send-to-losses',
  authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER),
  asyncHandler(productLotController.sendToLosses));

export default router;
