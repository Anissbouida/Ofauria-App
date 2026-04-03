import { Router } from 'express';
import { orderController } from '../controllers/order.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';

const router = Router();

const ORDER_ROLES = ['admin', 'manager', 'cashier', 'saleswoman'];

router.get('/', authenticate, orderController.list);
router.get('/for-date', authenticate, orderController.forDate);
router.get('/:id', authenticate, orderController.getById);
router.post('/', authenticate, authorize(...ORDER_ROLES), orderController.create);
router.put('/:id/status', authenticate, authorize(...ORDER_ROLES), orderController.updateStatus);

export default router;
