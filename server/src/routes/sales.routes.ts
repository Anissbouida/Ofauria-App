import { Router } from 'express';
import { saleController } from '../controllers/sale.controller.js';
import { printerController } from '../controllers/printer.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { checkoutSchema, paySaleSchema } from '../validators/sale.validator.js';
import { posAllowsNegativeStock, getPersonSizes, requiresUnsoldInventory } from '../services/module-parameters.service.js';
import { emptyBody } from '../validators/common.validator.js';
import { validateUuidParams } from '../middleware/validate.middleware.js';
import { cancelSaleSchema, invoiceSaleSchema, importSalesSchema } from '../validators/sales-flow.validator.js';
import { offlineAbandonedSchema } from '../validators/pos-offline.validator.js';
import { posOfflineAbandonedRepository } from '../repositories/pos-offline-abandoned.repository.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';

const router = Router();

// Tous les handlers sont async : sans asyncHandler, une erreur (ex. vente refusee
// pour DLV/DDE atteinte, levee avec statusCode 409) devient une « unhandled
// rejection » et la requete reste pendante au lieu de renvoyer une reponse (F-037).
// asyncHandler route le rejet vers le middleware d'erreur -> reponse propre.
// Règles de caisse (mig 374) lues par le POS : vente sans stock vitrine autorisée ou non.
router.get('/pos-rules', authenticate, can('sales.pos_rules.view'), asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { sellWithoutStock: await posAllowsNegativeStock(), personSizes: await getPersonSizes(), requireUnsoldInventory: await requiresUnsoldInventory() } });
}));
router.get('/', authenticate, can('sales.view'), asyncHandler(saleController.list));
router.get('/today', authenticate, can('sales.today.view'), asyncHandler(saleController.todayStats));
router.get('/summary', authenticate, can('sales.summary.view'), asyncHandler(saleController.summary));
// Avant /:id pour que "deferred" ne soit pas capture comme un id de vente.
// Ouvert a SALES : la caissiere consulte et encaisse les impayes depuis le POS.
// G0-19 : plafond de remise du caissier et responsables habilités à valider un dépassement.
router.get('/discount-policy', authenticate, can('sales.discount_policy.view'), asyncHandler(saleController.discountPolicy));
router.get('/deferred', authenticate, can('sales.deferred.view'), asyncHandler(saleController.deferred));
router.get('/receivables', authenticate, can('sales.receivables.view'), asyncHandler(saleController.receivables));
// G0-21 (mig 596) : ventes hors ligne refusées puis abandonnées à la caisse. La caisse
// remonte chaque abandon (droit de vendre) ; la direction le consulte (droit d'annuler un ticket).
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
router.get('/offline-abandoned', authenticate, can('sales.cancel'), asyncHandler(async (req: AuthRequest, res) => {
  const { dateFrom, dateTo, limit } = req.query as Record<string, string | undefined>;
  if ((dateFrom && !DAY_RE.test(dateFrom)) || (dateTo && !DAY_RE.test(dateTo))) {
    res.status(400).json({ success: false, error: { message: 'Date attendue au format AAAA-MM-JJ' } }); return;
  }
  const rows = await posOfflineAbandonedRepository.list({ storeId: req.user!.storeId, dateFrom, dateTo, limit: limit ? parseInt(limit, 10) || undefined : undefined });
  res.json({ success: true, data: rows });
}));
router.post('/offline-abandoned', authenticate, can('sales.checkout'), validate(offlineAbandonedSchema), asyncHandler(async (req: AuthRequest, res) => {
  const { row, created } = await posOfflineAbandonedRepository.record(req.body, { userId: req.user!.userId, storeId: req.user!.storeId });
  res.status(created ? 201 : 200).json({ success: true, data: row });
}));
router.get('/:id', authenticate, can('sales.view'), asyncHandler(saleController.getById));
router.post(
  '/checkout',
  authenticate,
  can('sales.checkout'),
  validate(checkoutSchema),
  asyncHandler(saleController.checkout),
);
// Vente spéciale B2B retirée (O2C L4) : commande ou BL professionnel, facture sur livré.
router.post('/special', authenticate, validate(emptyBody), saleController.specialRetired);
router.put('/special/:id', authenticate, validate(emptyBody), saleController.specialRetired);
router.delete('/special/:id', authenticate, saleController.specialRetired);
router.post(
  '/:id/pay',
  authenticate,
  can('sales.pay'),
  validate(paySaleSchema),
  asyncHandler(saleController.pay),
);
router.post('/import', authenticate, can('sales.import'), validate(importSalesSchema), asyncHandler(saleController.importCSV));
router.post('/:id/print', authenticate, can('sales.print'), validateUuidParams('id'), validate(emptyBody), asyncHandler(printerController.printSale));
// Facture depuis un ticket (phase 5.5) : pièce légale émise pour une vente déjà encaissée.
router.post('/:id/invoice', authenticate, can('sales.invoice'), validateUuidParams('id'), validate(invoiceSaleSchema), asyncHandler(saleController.invoice));
// Annulation de ticket (phase 8.1) : direction seulement, avec motif et approbateur.
router.post('/:id/cancel', authenticate, can('sales.cancel'), validateUuidParams('id'), validate(cancelSaleSchema), asyncHandler(saleController.cancel));

export default router;
