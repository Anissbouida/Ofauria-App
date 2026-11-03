import { Router } from 'express';
import { saleController } from '../controllers/sale.controller.js';
import { printerController } from '../controllers/printer.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { checkoutSchema, paySaleSchema } from '../validators/sale.validator.js';
import { ROLE_GROUPS } from '@ofauria/shared';
import { posAllowsNegativeStock, getPersonSizes } from '../services/module-parameters.service.js';

const router = Router();

// Tous les handlers sont async : sans asyncHandler, une erreur (ex. vente refusee
// pour DLV/DDE atteinte, levee avec statusCode 409) devient une « unhandled
// rejection » et la requete reste pendante au lieu de renvoyer une reponse (F-037).
// asyncHandler route le rejet vers le middleware d'erreur -> reponse propre.
// Règles de caisse (mig 374) lues par le POS : vente sans stock vitrine autorisée ou non.
router.get('/pos-rules', authenticate, authorize(...ROLE_GROUPS.SALES), asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { sellWithoutStock: await posAllowsNegativeStock(), personSizes: await getPersonSizes() } });
}));
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
// Vente spéciale B2B retirée (O2C L4) : commande ou BL professionnel, facture sur livré.
router.post('/special', authenticate, saleController.specialRetired);
router.put('/special/:id', authenticate, saleController.specialRetired);
router.delete('/special/:id', authenticate, saleController.specialRetired);
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
