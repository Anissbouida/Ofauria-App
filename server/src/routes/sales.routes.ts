import { Router } from 'express';
import { saleController } from '../controllers/sale.controller.js';
import { printerController } from '../controllers/printer.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { checkoutSchema, paySaleSchema, specialSaleSchema } from '../validators/sale.validator.js';
import { ROLE_GROUPS, ROLES } from '@ofauria/shared';

const router = Router();

// Tous les handlers sont async : sans asyncHandler, une erreur (ex. vente refusee
// pour DLV/DDE atteinte, levee avec statusCode 409) devient une « unhandled
// rejection » et la requete reste pendante au lieu de renvoyer une reponse (F-037).
// asyncHandler route le rejet vers le middleware d'erreur -> reponse propre.
router.get('/', authenticate, authorize(...ROLE_GROUPS.SALES), asyncHandler(saleController.list));
router.get('/today', authenticate, authorize(...ROLE_GROUPS.SALES), asyncHandler(saleController.todayStats));
router.get('/summary', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(saleController.summary));
// Avant /:id pour que "deferred" ne soit pas capture comme un id de vente.
// Ouvert a SALES : la caissiere consulte et encaisse les impayes depuis le POS.
router.get('/deferred', authenticate, authorize(...ROLE_GROUPS.SALES), asyncHandler(saleController.deferred));
router.get('/receivables', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(saleController.receivables));
router.get('/:id', authenticate, authorize(...ROLE_GROUPS.SALES), asyncHandler(saleController.getById));
router.post(
  '/checkout',
  authenticate,
  authorize(...ROLE_GROUPS.SALES),
  validate(checkoutSchema),
  asyncHandler(saleController.checkout),
);
// Vente speciale B2B : back-office, admin/manager uniquement.
router.post(
  '/special',
  authenticate,
  authorize(...ROLE_GROUPS.ADMIN_MANAGER),
  validate(specialSaleSchema),
  asyncHandler(saleController.createSpecial),
);
// Edition / suppression d'une vente speciale : admin uniquement (correction
// retroactive d'erreurs de saisie). Restreint a sale_type='special' cote repo.
router.put(
  '/special/:id',
  authenticate,
  authorize(ROLES.ADMIN),
  validate(specialSaleSchema),
  asyncHandler(saleController.updateSpecial),
);
router.delete(
  '/special/:id',
  authenticate,
  authorize(ROLES.ADMIN),
  asyncHandler(saleController.deleteSpecial),
);
router.post(
  '/:id/pay',
  authenticate,
  authorize(...ROLE_GROUPS.SALES),
  validate(paySaleSchema),
  asyncHandler(saleController.pay),
);
router.post('/import', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(saleController.importCSV));
router.post('/:id/print', authenticate, authorize(...ROLE_GROUPS.SALES), asyncHandler(printerController.printSale));

export default router;
