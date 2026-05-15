import { Router } from 'express';
import { saleController } from '../controllers/sale.controller.js';
import { printerController } from '../controllers/printer.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { checkoutSchema, paySaleSchema } from '../validators/sale.validator.js';
import { ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

router.get('/', authenticate, authorize(...ROLE_GROUPS.SALES), saleController.list);
router.get('/today', authenticate, authorize(...ROLE_GROUPS.SALES), saleController.todayStats);
router.get('/summary', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), saleController.summary);
router.get('/:id', authenticate, authorize(...ROLE_GROUPS.SALES), saleController.getById);
router.post(
  '/checkout',
  authenticate,
  authorize(...ROLE_GROUPS.SALES),
  validate(checkoutSchema),
  saleController.checkout,
);
router.post(
  '/:id/pay',
  authenticate,
  authorize(...ROLE_GROUPS.SALES),
  validate(paySaleSchema),
  saleController.pay,
);
router.post('/import', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), saleController.importCSV);
router.post('/:id/print', authenticate, authorize(...ROLE_GROUPS.SALES), printerController.printSale);

export default router;
