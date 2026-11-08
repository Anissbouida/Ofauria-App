import { Router } from 'express';
import { receptionVoucherController } from '../controllers/reception-voucher.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { validateUuidParams } from '../middleware/validate.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

router.get('/', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), receptionVoucherController.list);
// Écarts de prix (lot L3 P2P) — avant '/:id' pour ne pas être capté comme un id.
// La décision est un contrôle de gestion : réservée au gérant/admin.
router.get('/price-variances', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), receptionVoucherController.priceVariances);
router.put('/items/:id/price-decision', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), receptionVoucherController.decidePrice);
// Simulation de réévaluation (lot L3 P2P, 3/5) — lecture seule, avant '/:id'.
router.get('/revaluation-candidates', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), receptionVoucherController.revaluationCandidates);
router.get('/invoices/:invoiceId/revaluation-preview', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('invoiceId'), receptionVoucherController.revaluationPreview);
router.get('/:id', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), receptionVoucherController.getById);
router.post('/', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), receptionVoucherController.create);
router.get('/purchase-order/:poId', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), receptionVoucherController.findByPurchaseOrder);

export default router;
