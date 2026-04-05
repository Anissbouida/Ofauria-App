import { Router } from 'express';
import { purchaseOrderController } from '../controllers/purchase-order.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';

const router = Router();

const ROLES = ['admin', 'manager'];

router.get('/', authenticate, authorize(...ROLES), purchaseOrderController.list);
router.get('/overdue', authenticate, authorize(...ROLES), purchaseOrderController.overdue);
router.get('/:id', authenticate, authorize(...ROLES), purchaseOrderController.getById);
router.post('/', authenticate, authorize(...ROLES), purchaseOrderController.create);
router.post('/:id/send', authenticate, authorize(...ROLES), purchaseOrderController.send);
router.post('/:id/confirm-delivery', authenticate, authorize(...ROLES), purchaseOrderController.confirmDelivery);
router.post('/:id/not-delivered', authenticate, authorize(...ROLES), purchaseOrderController.markNotDelivered);
router.post('/:id/cancel', authenticate, authorize(...ROLES), purchaseOrderController.cancel);
router.delete('/:id', authenticate, authorize('admin'), purchaseOrderController.remove);

export default router;
