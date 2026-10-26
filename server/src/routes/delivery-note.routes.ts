import { Router } from 'express';
import { ROLE_GROUPS } from '@ofauria/shared';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { deliveryNoteController as c } from '../controllers/delivery-note.controller.js';

/** Ventes aux professionnels (mig 352) — admin et gérant, comme l'ancienne vente spéciale. */
const router = Router();
const staff = [authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER)];
router.get('/', ...staff, asyncHandler(c.list));
router.get('/to-invoice', ...staff, asyncHandler(c.toInvoice));
router.get('/line-defaults', ...staff, asyncHandler(c.lineDefaults));
router.get('/orders/:customerId', ...staff, asyncHandler(c.eligibleOrders));
router.get('/order-lines/:orderId', ...staff, asyncHandler(c.orderLines));
router.post('/invoice', ...staff, asyncHandler(c.invoice));
router.get('/:id', ...staff, asyncHandler(c.getById));
router.post('/', ...staff, asyncHandler(c.create));
router.post('/:id/cancel', ...staff, asyncHandler(c.cancel));
export default router;
