import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { deliveryNoteController as c } from '../controllers/delivery-note.controller.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { emptyBody } from '../validators/common.validator.js';
import { createDeliveryNoteSchema, createPreparedDeliveryNoteSchema, deliveryNoteFromOrderSchema, shipDeliveryNoteSchema, deliverDeliveryNoteSchema, invoiceDeliveryNotesSchema } from '../validators/sales-flow.validator.js';

/** Ventes aux professionnels (mig 352) — admin et gérant, comme l'ancienne vente spéciale. */
const router = Router();
router.get('/', authenticate, can('sales.delivery_notes.view'), asyncHandler(c.list));
router.get('/to-invoice', authenticate, can('sales.delivery_notes.view'), asyncHandler(c.toInvoice));
router.get('/line-defaults', authenticate, can('sales.delivery_notes.view'), asyncHandler(c.lineDefaults));
router.get('/orders/:customerId', authenticate, can('sales.delivery_notes.view'), asyncHandler(c.eligibleOrders));
router.get('/order-lines/:orderId', authenticate, can('sales.delivery_notes.view'), asyncHandler(c.orderLines));
router.post('/invoice', authenticate, can('sales.delivery_notes.invoice'), validate(invoiceDeliveryNotesSchema), asyncHandler(c.invoice));
router.post('/from-order/:orderId', authenticate, can('sales.delivery_notes.from_order'), validateUuidParams('orderId'), validate(deliveryNoteFromOrderSchema), asyncHandler(c.createFromOrder));
router.get('/:id/pdf', authenticate, can('sales.delivery_notes.view'), asyncHandler(c.pdf));
router.get('/:id', authenticate, can('sales.delivery_notes.view'), asyncHandler(c.getById));
router.post('/', authenticate, can('sales.delivery_notes.create'), validate(createDeliveryNoteSchema), asyncHandler(c.create));
// Cycle différé (phase 7.1) : préparer → expédier → livrer.
router.get('/picking-list', authenticate, can('sales.delivery_notes.view'), asyncHandler(c.pickingList));
router.post('/prepared', authenticate, can('sales.delivery_notes.prepared'), validate(createPreparedDeliveryNoteSchema), asyncHandler(c.createPrepared));
router.post('/:id/ship', authenticate, can('sales.delivery_notes.ship'), validateUuidParams('id'), validate(shipDeliveryNoteSchema), asyncHandler(c.ship));
router.post('/:id/deliver', authenticate, can('sales.delivery_notes.deliver'), validateUuidParams('id'), validate(deliverDeliveryNoteSchema), asyncHandler(c.markDelivered));
router.post('/:id/cancel', authenticate, can('sales.delivery_notes.cancel'), validateUuidParams('id'), validate(emptyBody), asyncHandler(c.cancel));
export default router;
