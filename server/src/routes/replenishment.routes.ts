import { Router } from 'express';
import { replenishmentController } from '../controllers/replenishment.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS, ROLES } from '@ofauria/shared';

/** Store-facing staff */
const STORE_STAFF = [ROLES.ADMIN, ROLES.MANAGER, ROLES.CASHIER, ROLES.SALESWOMAN];
/** Responsable produit + admin/manager */
const RESPONSABLE = [...ROLE_GROUPS.PRODUCTION, ...ROLE_GROUPS.ADMIN_MANAGER];

const router = Router();

// List & detail
router.get('/', authenticate, asyncHandler(replenishmentController.list));
router.get('/recommendations', authenticate, asyncHandler(replenishmentController.recommendations));
router.get('/check-today', authenticate, authorize(...STORE_STAFF), asyncHandler(replenishmentController.checkToday));
router.get('/closing-inventory', authenticate, authorize(...STORE_STAFF), asyncHandler(replenishmentController.closingInventory));
router.get('/pending-transfers', authenticate, authorize(...STORE_STAFF), asyncHandler(replenishmentController.pendingTransfers));
router.get('/:id', authenticate, asyncHandler(replenishmentController.getById));

// Validation — store staff
router.post('/check-items', authenticate, authorize(...STORE_STAFF), asyncHandler(replenishmentController.checkItems));

// Step 1: Create — store staff only
router.post('/', authenticate, authorize(...STORE_STAFF), asyncHandler(replenishmentController.create));

// Step 2: Acknowledge — responsable produit / admin / manager
router.post('/:id/acknowledge', authenticate, authorize(...RESPONSABLE), asyncHandler(replenishmentController.acknowledge));

// Step 3: Start preparing — responsable produit / admin / manager
router.post('/:id/prepare', authenticate, authorize(...RESPONSABLE), asyncHandler(replenishmentController.startPreparing));

// Step 4: Transfer — responsable produit / admin / manager
router.post('/:id/transfer', authenticate, authorize(...RESPONSABLE), asyncHandler(replenishmentController.transfer));

// Step 5: Confirm reception — store staff (cashier)
router.post('/:id/confirm-reception', authenticate, authorize(...STORE_STAFF), asyncHandler(replenishmentController.confirmReception));

// Save inventory check — store staff
router.post('/inventory-check', authenticate, authorize(...STORE_STAFF), asyncHandler(replenishmentController.saveInventoryCheck));

// Cancel — store staff + admin/manager
router.post('/:id/cancel', authenticate, authorize(...STORE_STAFF, ...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(replenishmentController.cancel));

export default router;
