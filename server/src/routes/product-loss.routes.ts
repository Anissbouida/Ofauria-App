import { Router } from 'express';
import { productLossController } from '../controllers/product-loss.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

router.get('/', authenticate, productLossController.list);
router.get('/stats', authenticate, productLossController.stats);
router.post('/', authenticate, authorize(...ROLE_GROUPS.PRODUCTION, ...ROLE_GROUPS.ADMIN_MANAGER, ...ROLE_GROUPS.STORE_STAFF), productLossController.create);
router.delete('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), productLossController.remove);

export default router;
