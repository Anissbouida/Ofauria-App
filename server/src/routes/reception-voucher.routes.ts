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
router.get('/:id', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), receptionVoucherController.getById);
router.post('/', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), receptionVoucherController.create);
router.get('/purchase-order/:poId', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), receptionVoucherController.findByPurchaseOrder);

export default router;
