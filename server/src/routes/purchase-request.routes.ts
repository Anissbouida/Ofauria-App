import { Router } from 'express';
import { purchaseRequestController } from '../controllers/purchase-request.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

router.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), purchaseRequestController.list);
router.get('/grouped', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), purchaseRequestController.grouped);
router.get('/count', authenticate, purchaseRequestController.count);
router.post('/', authenticate, purchaseRequestController.create);
router.put('/:id/quantity', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), purchaseRequestController.updateQuantity);
router.post('/:id/cancel', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), purchaseRequestController.cancel);
router.post('/generate-po', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), purchaseRequestController.generatePO);

export default router;
