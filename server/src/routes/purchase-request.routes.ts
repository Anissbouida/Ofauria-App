import { Router } from 'express';
import { purchaseRequestController } from '../controllers/purchase-request.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS } from '@ofauria/shared';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import {
  createPurchaseRequestSchema, updateQuantitySchema, assignSupplierSchema,
  bulkAssignSupplierSchema, reasonSchema,
} from '../validators/purchase-request.validator.js';

// Qui exprime un besoin : chefs, magasinier, gérant, admin (pas la caisse ni la vente).
const REQUESTERS = Array.from(new Set([...ROLE_GROUPS.PRODUCTION, ...ROLE_GROUPS.WAREHOUSE]));

const router = Router();

// asyncHandler obligatoire : sans lui (Express 4), une exception dans un
// controleur async ne rejoint jamais le middleware d'erreur — la requete reste
// pendante et le front tourne indefiniment sans message.
router.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(purchaseRequestController.list));
// Stock › À commander : besoins fusionnés (ruptures, demandes, stock bas). Flux
// procure-to-pay (mig 456) : cet écran ne crée que des DA (plus de BC direct),
// via POST / ci-dessous ; le BC naît ensuite d'une DA approuvée.
router.get('/to-order', authenticate, authorize(...REQUESTERS), asyncHandler(purchaseRequestController.toOrder));
router.get('/grouped', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(purchaseRequestController.grouped));
router.get('/count', authenticate, authorize(...REQUESTERS), asyncHandler(purchaseRequestController.count));
router.get('/:id/actions', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(purchaseRequestController.actions));
router.get('/:id/history', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(purchaseRequestController.history));
router.post('/', authenticate, authorize(...REQUESTERS), validate(createPurchaseRequestSchema), asyncHandler(purchaseRequestController.create));
// Soumettre une proposition (DA brouillon générée par le MRP, L6) à l'approbation.
router.post('/:id/submit', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(purchaseRequestController.submit));
router.put('/:id/quantity', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), validate(updateQuantitySchema), asyncHandler(purchaseRequestController.updateQuantity));
router.put('/:id/supplier', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), validate(assignSupplierSchema), asyncHandler(purchaseRequestController.assignSupplier));
router.post('/bulk-assign-supplier', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(bulkAssignSupplierSchema), asyncHandler(purchaseRequestController.bulkAssignSupplier));
router.post('/:id/cancel', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), validate(reasonSchema), asyncHandler(purchaseRequestController.cancel));
router.post('/:id/close', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), validate(reasonSchema), asyncHandler(purchaseRequestController.close));
// Flux procure-to-pay (mig 457) : plus de route DA→BC direct. Le sourcing se fait via
// POST /rfqs/from-requests, et le BC naît de l'attribution de l'appel d'offres.

export default router;
