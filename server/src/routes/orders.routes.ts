import { Router } from 'express';
import { ROLE_GROUPS } from '@ofauria/shared';
import { orderController } from '../controllers/order.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

const ORDER_ROLES = ROLE_GROUPS.SALES;

router.get('/', authenticate, asyncHandler(orderController.list));
router.get('/for-date', authenticate, asyncHandler(orderController.forDate));
router.get('/:id', authenticate, asyncHandler(orderController.getById));
router.post('/', authenticate, can('orders.create'), asyncHandler(orderController.create));
router.put('/:id', authenticate, can('orders.edit'), asyncHandler(orderController.update));
router.put('/:id/status', authenticate, can('orders.status'), asyncHandler(orderController.updateStatus));
router.post('/:id/reschedule', authenticate, can('orders.reschedule'), asyncHandler(orderController.reschedule));
router.post('/:id/deliver', authenticate, can('orders.deliver'), asyncHandler(orderController.deliver));
// Facture d'acompte (phase 5.4) : réservée à la direction (admin/gérant).
router.post('/:id/prepayment-invoice', authenticate, can('orders.prepayment_invoice'), asyncHandler(orderController.prepaymentInvoice));
router.delete('/:id', authenticate, can('orders.delete'), asyncHandler(orderController.remove));

export default router;
