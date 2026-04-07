import { Router } from 'express';
import { purchaseOrderController } from '../controllers/purchase-order.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLES, ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

router.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), purchaseOrderController.list);
router.get('/eligible', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), purchaseOrderController.eligible);
router.get('/overdue', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), purchaseOrderController.overdue);
router.get('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), purchaseOrderController.getById);
router.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), purchaseOrderController.create);
router.post('/:id/send', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), purchaseOrderController.send);
router.post('/:id/confirm-delivery', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), purchaseOrderController.confirmDelivery);
router.post('/:id/not-delivered', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), purchaseOrderController.markNotDelivered);
router.post('/:id/cancel', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), purchaseOrderController.cancel);
router.delete('/:id', authenticate, authorize(ROLES.ADMIN), purchaseOrderController.remove);

export default router;
