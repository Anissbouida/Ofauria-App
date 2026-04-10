import { Router } from 'express';
import { receptionVoucherController } from '../controllers/reception-voucher.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

router.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), receptionVoucherController.list);
router.get('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), receptionVoucherController.getById);
router.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), receptionVoucherController.create);
router.get('/purchase-order/:poId', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), receptionVoucherController.findByPurchaseOrder);

export default router;
