import { Router } from 'express';
import { saleController } from '../controllers/sale.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

router.get('/', authenticate, authorize(...ROLE_GROUPS.SALES), saleController.list);
router.get('/today', authenticate, authorize(...ROLE_GROUPS.SALES), saleController.todayStats);
router.get('/summary', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), saleController.summary);
router.get('/:id', authenticate, authorize(...ROLE_GROUPS.SALES), saleController.getById);
router.post('/checkout', authenticate, authorize(...ROLE_GROUPS.SALES), saleController.checkout);
router.post('/import', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), saleController.importCSV);

export default router;
