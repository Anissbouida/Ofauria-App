import { Router } from 'express';
import { purchaseOrderController } from '../controllers/purchase-order.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { requireVerb } from '../middleware/module.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { reasonCodeSchema, optionalNoteSchema, changeOrderSchema, correctReceiptSchema, createPurchaseOrderSchema } from '../validators/purchase-order-action.validator.js';
import { emptyBody } from '../validators/common.validator.js';
import { sendPurchaseOrderSchema, confirmDeliverySchema, updatePoPricesSchema, updatePoHeaderSchema, replacePoItemsSchema } from '../validators/purchasing-flow.validator.js';
import { idempotent } from '../middleware/idempotency.middleware.js';
import { listActions } from '../services/document-actions.service.js';

const router = Router();

router.get('/', authenticate, can('purchasing.purchase_orders.view_list'), purchaseOrderController.list);
router.get('/eligible', authenticate, can('purchasing.purchase_orders.eligible.view'), purchaseOrderController.eligible);
router.get('/overdue', authenticate, can('purchasing.purchase_orders.overdue.view'), purchaseOrderController.overdue);
router.get('/board', authenticate, can('purchasing.purchase_orders.board.view'), asyncHandler(purchaseOrderController.board));
router.get('/pipeline', authenticate, can('purchasing.purchase_orders.pipeline.view'), asyncHandler(purchaseOrderController.pipeline));
// F-006 : le magasinier (WAREHOUSE) consulte un BC et confirme sa reception —
// c'est lui qui recoit physiquement la livraison. La creation/validation/
// annulation des BC reste au gerant (ADMIN_MANAGER).
router.get('/:id', authenticate, can('purchasing.purchase_orders.view_detail'), purchaseOrderController.getById);
router.post('/', authenticate, can('purchasing.purchase_orders.create'), validate(createPurchaseOrderSchema), idempotent(), purchaseOrderController.create);
router.post('/:id/send', authenticate, can('purchasing.purchase_orders.send'), requireVerb('purchasing', 'approve'), validateUuidParams('id'), validate(sendPurchaseOrderSchema), asyncHandler(purchaseOrderController.send));
router.post('/:id/confirm-delivery', authenticate, can('purchasing.purchase_orders.confirm_delivery'), validateUuidParams('id'), validate(confirmDeliverySchema), idempotent(), purchaseOrderController.confirmDelivery);
// Actions motivées (mig 306) : code motif obligatoire, journalisées dans document_actions.
router.post('/:id/not-delivered', authenticate, can('purchasing.purchase_orders.not_delivered'), validateUuidParams('id'), validate(reasonCodeSchema), asyncHandler(purchaseOrderController.markNotDelivered));
router.post('/:id/cancel', authenticate, can('purchasing.purchase_orders.cancel'), validateUuidParams('id'), validate(reasonCodeSchema), asyncHandler(purchaseOrderController.cancel));
router.post('/:id/hold', authenticate, can('purchasing.purchase_orders.hold'), validateUuidParams('id'), validate(reasonCodeSchema), asyncHandler(purchaseOrderController.hold));
router.post('/:id/release', authenticate, can('purchasing.purchase_orders.release'), validateUuidParams('id'), validate(optionalNoteSchema), asyncHandler(purchaseOrderController.release));
router.post('/:id/freeze', authenticate, can('purchasing.purchase_orders.freeze'), validateUuidParams('id'), validate(optionalNoteSchema), asyncHandler(purchaseOrderController.freeze));
router.post('/:id/unfreeze', authenticate, can('purchasing.purchase_orders.unfreeze'), validateUuidParams('id'), validate(optionalNoteSchema), asyncHandler(purchaseOrderController.unfreeze));
// Reliquat et avenants (mig 307).
router.post('/:id/close-remainder', authenticate, can('purchasing.purchase_orders.close_remainder'), validateUuidParams('id'), validate(reasonCodeSchema), asyncHandler(purchaseOrderController.closeRemainder));
router.post('/:id/lines/:lineId/close-remainder', authenticate, can('purchasing.purchase_orders.close_remainder'), validateUuidParams('id', 'lineId'), validate(reasonCodeSchema), asyncHandler(purchaseOrderController.closeRemainder));
router.post('/:id/lines/:lineId/reopen', authenticate, can('purchasing.purchase_orders.reopen'), validateUuidParams('id', 'lineId'), validate(optionalNoteSchema), asyncHandler(purchaseOrderController.reopenRemainder));
router.post('/:id/change-orders', authenticate, can('purchasing.purchase_orders.change_orders'), validateUuidParams('id'), validate(changeOrderSchema), idempotent(), asyncHandler(purchaseOrderController.changeOrder));
router.get('/:id/versions', authenticate, can('purchasing.purchase_orders.versions.view'), validateUuidParams('id'), asyncHandler(purchaseOrderController.versions));
router.get('/:id/actions', authenticate, can('purchasing.purchase_orders.actions.view'), validateUuidParams('id'),
  asyncHandler(async (req, res) => { res.json({ success: true, data: await listActions('purchase_order', req.params.id) }); }));
// Annulation de la reception (reverse stock/facture/compta) — ADMIN uniquement.
router.post('/:id/cancel-reception', authenticate, can('purchasing.purchase_orders.cancel_reception'), validateUuidParams('id'), validate(reasonCodeSchema), purchaseOrderController.cancelReception);
// Correction d'une ligne de réception (gérant dans le délai paramétré, admin sans limite) — mig 308.
router.post('/:id/lines/:lineId/correct-receipt', authenticate, can('purchasing.purchase_orders.correct_receipt'), validateUuidParams('id', 'lineId'), validate(correctReceiptSchema), asyncHandler(purchaseOrderController.correctReceipt));
router.post('/:id/update-prices', authenticate, can('purchasing.purchase_orders.update_prices'), validateUuidParams('id'), validate(updatePoPricesSchema), purchaseOrderController.updatePrices);
// Generation manuelle de la facture pour un BC livre_complet (rattrapage quand
// l'auto-creation au moment de la reception n'a pas eu lieu — prix tardifs).
router.post('/:id/invoice', authenticate, can('purchasing.purchase_orders.invoice'), validateUuidParams('id'), validate(emptyBody), purchaseOrderController.generateInvoice);
// Edition complete admin/gerant : en-tete + lignes (qty, prix, add/remove).
router.put('/:id', authenticate, can('purchasing.purchase_orders.edit'), validateUuidParams('id'), validate(updatePoHeaderSchema), purchaseOrderController.updateHeader);
router.put('/:id/items', authenticate, can('purchasing.purchase_orders.items'), validateUuidParams('id'), validate(replacePoItemsSchema), purchaseOrderController.replaceItems);
router.get('/:id/download-pdf', authenticate, can('purchasing.purchase_orders.download_pdf.view'), purchaseOrderController.downloadPdf);
router.delete('/:id', authenticate, can('purchasing.purchase_orders.delete'), purchaseOrderController.remove);

export default router;
