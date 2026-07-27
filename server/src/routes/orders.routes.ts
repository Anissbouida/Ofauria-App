import { Router } from 'express';
import { ROLE_GROUPS } from '@ofauria/shared';
import { orderController } from '../controllers/order.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

const ORDER_ROLES = ROLE_GROUPS.SALES;

router.get('/', authenticate, asyncHandler(orderController.list));
router.get('/for-date', authenticate, asyncHandler(orderController.forDate));
router.get('/:id', authenticate, asyncHandler(orderController.getById));
router.post('/', authenticate, authorize(...ORDER_ROLES), asyncHandler(orderController.create));
router.put('/:id', authenticate, authorize(...ORDER_ROLES), asyncHandler(orderController.update));
router.put('/:id/status', authenticate, authorize(...ORDER_ROLES), asyncHandler(orderController.updateStatus));
router.post('/:id/deliver', authenticate, authorize(...ORDER_ROLES), asyncHandler(orderController.deliver));
router.delete('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(orderController.remove));

export default router;
