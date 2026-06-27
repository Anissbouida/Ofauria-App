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
// Annulation de la reception (reverse stock/facture/compta) — ADMIN uniquement.
router.post('/:id/cancel-reception', authenticate, authorize(ROLES.ADMIN), purchaseOrderController.cancelReception);
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
