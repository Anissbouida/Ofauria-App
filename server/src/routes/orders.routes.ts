import { Router } from 'express';
import { ROLE_GROUPS } from '@ofauria/shared';
import { orderController } from '../controllers/order.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';

const router = Router();

const ORDER_ROLES = ROLE_GROUPS.SALES;

router.get('/', authenticate, orderController.list);
router.get('/for-date', authenticate, orderController.forDate);
router.get('/:id', authenticate, orderController.getById);
router.post('/', authenticate, authorize(...ORDER_ROLES), orderController.create);
router.put('/:id', authenticate, authorize(...ORDER_ROLES), orderController.update);
router.put('/:id/status', authenticate, authorize(...ORDER_ROLES), orderController.updateStatus);
router.post('/:id/deliver', authenticate, authorize(...ORDER_ROLES), orderController.deliver);

export default router;
