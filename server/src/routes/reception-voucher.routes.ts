import { Router } from 'express';
import { receptionVoucherController } from '../controllers/reception-voucher.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { createReceptionVoucherSchema, priceDecisionSchema } from '../validators/purchasing-flow.validator.js';

const router = Router();

router.get('/', authenticate, can('purchasing.reception_vouchers.view'), receptionVoucherController.list);
// Écarts de prix (lot L3 P2P) — avant '/:id' pour ne pas être capté comme un id.
// La décision est un contrôle de gestion : réservée au gérant/admin.
router.get('/price-variances', authenticate, can('purchasing.reception_vouchers.price_variances.view'), receptionVoucherController.priceVariances);
router.put('/items/:id/price-decision', authenticate, can('purchasing.reception_vouchers.price_decision'), validateUuidParams('id'), validate(priceDecisionSchema), receptionVoucherController.decidePrice);
// Simulation de réévaluation (lot L3 P2P, 3/5) — lecture seule, avant '/:id'.
router.get('/revaluation-candidates', authenticate, can('purchasing.reception_vouchers.revaluation_candidates.view'), receptionVoucherController.revaluationCandidates);
router.get('/invoices/:invoiceId/revaluation-preview', authenticate, can('purchasing.reception_vouchers.invoices_revaluation_preview.view'), validateUuidParams('invoiceId'), receptionVoucherController.revaluationPreview);
router.get('/:id', authenticate, can('purchasing.reception_vouchers.view'), receptionVoucherController.getById);
router.post('/', authenticate, can('purchasing.reception_vouchers.create'), validate(createReceptionVoucherSchema), receptionVoucherController.create);
router.get('/purchase-order/:poId', authenticate, can('purchasing.reception_vouchers.purchase_order.view'), receptionVoucherController.findByPurchaseOrder);

export default router;
