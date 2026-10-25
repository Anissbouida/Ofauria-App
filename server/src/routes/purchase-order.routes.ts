import { Router } from 'express';
import { purchaseOrderController } from '../controllers/purchase-order.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { requireVerb } from '../middleware/module.middleware.js';
import { ROLES, ROLE_GROUPS } from '@ofauria/shared';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { reasonCodeSchema, optionalNoteSchema, changeOrderSchema, correctReceiptSchema, createPurchaseOrderSchema } from '../validators/purchase-order-action.validator.js';
import { idempotent } from '../middleware/idempotency.middleware.js';
import { listActions } from '../services/document-actions.service.js';

const router = Router();

router.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), purchaseOrderController.list);
router.get('/eligible', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), purchaseOrderController.eligible);
router.get('/overdue', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), purchaseOrderController.overdue);
router.get('/board', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(purchaseOrderController.board));
router.get('/pipeline', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(purchaseOrderController.pipeline));
// F-006 : le magasinier (WAREHOUSE) consulte un BC et confirme sa reception —
// c'est lui qui recoit physiquement la livraison. La creation/validation/
// annulation des BC reste au gerant (ADMIN_MANAGER).
router.get('/:id', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), purchaseOrderController.getById);
router.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(createPurchaseOrderSchema), idempotent(), purchaseOrderController.create);
router.post('/:id/send', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), requireVerb('purchasing', 'approve'), validateUuidParams('id'), asyncHandler(purchaseOrderController.send));
router.post('/:id/confirm-delivery', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), idempotent(), purchaseOrderController.confirmDelivery);
// Actions motivées (mig 306) : code motif obligatoire, journalisées dans document_actions.
router.post('/:id/not-delivered', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), validate(reasonCodeSchema), asyncHandler(purchaseOrderController.markNotDelivered));
router.post('/:id/cancel', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), validate(reasonCodeSchema), asyncHandler(purchaseOrderController.cancel));
router.post('/:id/hold', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), validate(reasonCodeSchema), asyncHandler(purchaseOrderController.hold));
router.post('/:id/release', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), validate(optionalNoteSchema), asyncHandler(purchaseOrderController.release));
router.post('/:id/freeze', authenticate, authorize(ROLES.ADMIN), validateUuidParams('id'), validate(optionalNoteSchema), asyncHandler(purchaseOrderController.freeze));
router.post('/:id/unfreeze', authenticate, authorize(ROLES.ADMIN), validateUuidParams('id'), validate(optionalNoteSchema), asyncHandler(purchaseOrderController.unfreeze));
// Reliquat et avenants (mig 307).
router.post('/:id/close-remainder', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), validate(reasonCodeSchema), asyncHandler(purchaseOrderController.closeRemainder));
router.post('/:id/lines/:lineId/close-remainder', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id', 'lineId'), validate(reasonCodeSchema), asyncHandler(purchaseOrderController.closeRemainder));
router.post('/:id/lines/:lineId/reopen', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id', 'lineId'), validate(optionalNoteSchema), asyncHandler(purchaseOrderController.reopenRemainder));
router.post('/:id/change-orders', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), validate(changeOrderSchema), idempotent(), asyncHandler(purchaseOrderController.changeOrder));
router.get('/:id/versions', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(purchaseOrderController.versions));
router.get('/:id/actions', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'),
  asyncHandler(async (req, res) => { res.json({ success: true, data: await listActions('purchase_order', req.params.id) }); }));
// Annulation de la reception (reverse stock/facture/compta) — ADMIN uniquement.
router.post('/:id/cancel-reception', authenticate, authorize(ROLES.ADMIN), validateUuidParams('id'), validate(reasonCodeSchema), purchaseOrderController.cancelReception);
// Correction d'une ligne de réception (gérant dans le délai paramétré, admin sans limite) — mig 308.
router.post('/:id/lines/:lineId/correct-receipt', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id', 'lineId'), validate(correctReceiptSchema), asyncHandler(purchaseOrderController.correctReceipt));
router.post('/:id/update-prices', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), purchaseOrderController.updatePrices);
// Generation manuelle de la facture pour un BC livre_complet (rattrapage quand
// l'auto-creation au moment de la reception n'a pas eu lieu — prix tardifs).
router.post('/:id/invoice', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), purchaseOrderController.generateInvoice);
// Edition complete admin/gerant : en-tete + lignes (qty, prix, add/remove).
router.put('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), purchaseOrderController.updateHeader);
router.put('/:id/items', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), purchaseOrderController.replaceItems);
router.get('/:id/download-pdf', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), purchaseOrderController.downloadPdf);
router.delete('/:id', authenticate, authorize(ROLES.ADMIN), purchaseOrderController.remove);

export default router;
