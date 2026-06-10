import { Router } from 'express';
import { saleController } from '../controllers/sale.controller.js';
import { printerController } from '../controllers/printer.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { checkoutSchema, paySaleSchema, specialSaleSchema } from '../validators/sale.validator.js';
import { ROLE_GROUPS, ROLES } from '@ofauria/shared';

const router = Router();

router.get('/', authenticate, authorize(...ROLE_GROUPS.SALES), saleController.list);
router.get('/today', authenticate, authorize(...ROLE_GROUPS.SALES), saleController.todayStats);
router.get('/summary', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), saleController.summary);
// Avant /:id pour que "deferred" ne soit pas capture comme un id de vente.
// Ouvert a SALES : la caissiere consulte et encaisse les impayes depuis le POS.
router.get('/deferred', authenticate, authorize(...ROLE_GROUPS.SALES), saleController.deferred);
router.get('/:id', authenticate, authorize(...ROLE_GROUPS.SALES), saleController.getById);
router.post(
  '/checkout',
  authenticate,
  authorize(...ROLE_GROUPS.SALES),
  validate(checkoutSchema),
  saleController.checkout,
);
// Vente speciale B2B : back-office, admin/manager uniquement.
router.post(
  '/special',
  authenticate,
  authorize(...ROLE_GROUPS.ADMIN_MANAGER),
  validate(specialSaleSchema),
  saleController.createSpecial,
);
// Edition / suppression d'une vente speciale : admin uniquement (correction
// retroactive d'erreurs de saisie). Restreint a sale_type='special' cote repo.
router.put(
  '/special/:id',
  authenticate,
  authorize(ROLES.ADMIN),
  validate(specialSaleSchema),
  saleController.updateSpecial,
);
router.delete(
  '/special/:id',
  authenticate,
  authorize(ROLES.ADMIN),
  saleController.deleteSpecial,
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
