import { Router } from 'express';
import { replenishmentController } from '../controllers/replenishment.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS, ROLES } from '@ofauria/shared';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { emptyBody } from '../validators/common.validator.js';
import {
  replenishmentCheckItemsSchema, createReplenishmentSchema, prepareReplenishmentSchema,
  confirmReplenishmentReceptionSchema, replenishmentInventoryCheckSchema,
} from '../validators/purchasing-flow.validator.js';

/** Store-facing staff */
const STORE_STAFF = [ROLES.ADMIN, ROLES.MANAGER, ROLES.CASHIER, ROLES.SALESWOMAN];
/** Responsable produit + admin/manager */
const RESPONSABLE = [...ROLE_GROUPS.PRODUCTION, ...ROLE_GROUPS.ADMIN_MANAGER];

const router = Router();

// List & detail
router.get('/', authenticate, asyncHandler(replenishmentController.list));
router.get('/recommendations', authenticate, asyncHandler(replenishmentController.recommendations));
router.get('/check-today', authenticate, can('replenishment.view'), asyncHandler(replenishmentController.checkToday));
router.get('/closing-inventory', authenticate, can('replenishment.view'), asyncHandler(replenishmentController.closingInventory));
router.get('/pending-transfers', authenticate, can('replenishment.view'), asyncHandler(replenishmentController.pendingTransfers));
router.get('/:id', authenticate, asyncHandler(replenishmentController.getById));

// Validation — store staff
router.post('/check-items', authenticate, can('replenishment.check_items'), validate(replenishmentCheckItemsSchema), asyncHandler(replenishmentController.checkItems));

// Step 1: Create — store staff only
router.post('/', authenticate, can('replenishment.create'), validate(createReplenishmentSchema), asyncHandler(replenishmentController.create));

// Step 2: Acknowledge — responsable produit / admin / manager
router.post('/:id/acknowledge', authenticate, can('replenishment.acknowledge'), validateUuidParams('id'), validate(emptyBody), asyncHandler(replenishmentController.acknowledge));

// Step 3: Start preparing — responsable produit / admin / manager
router.post('/:id/prepare', authenticate, can('replenishment.prepare'), validateUuidParams('id'), validate(prepareReplenishmentSchema), asyncHandler(replenishmentController.startPreparing));

// Step 4: Transfer — responsable produit / admin / manager
router.post('/:id/transfer', authenticate, can('replenishment.transfer'), validateUuidParams('id'), validate(emptyBody), asyncHandler(replenishmentController.transfer));

// Step 5: Confirm reception — store staff (cashier)
router.post('/:id/confirm-reception', authenticate, can('replenishment.confirm_reception'), validateUuidParams('id'), validate(confirmReplenishmentReceptionSchema), asyncHandler(replenishmentController.confirmReception));

// Save inventory check — store staff
router.post('/inventory-check', authenticate, can('replenishment.inventory_check'), validate(replenishmentInventoryCheckSchema), asyncHandler(replenishmentController.saveInventoryCheck));

// Cancel — store staff + admin/manager
router.post('/:id/cancel', authenticate, can('replenishment.cancel'), validateUuidParams('id'), validate(emptyBody), asyncHandler(replenishmentController.cancel));

export default router;
