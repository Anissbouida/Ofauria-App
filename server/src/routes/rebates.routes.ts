import { Router } from 'express';
import { rebateController } from '../controllers/rebate.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validateUuidParams } from '../middleware/validate.middleware.js';

/**
 * Phase 11 (D5-12) — ristournes de fin d'année (RFA). Lecture : équipe de
 * vente ; créer / clôturer / annuler : direction.
 */
const router = Router();

router.get('/', authenticate, can('sales.rebates.view'), asyncHandler(rebateController.list));
router.get('/:id/compute', authenticate, can('sales.rebates.view'), validateUuidParams('id'), asyncHandler(rebateController.compute));
router.post('/', authenticate, can('sales.rebates.create'), asyncHandler(rebateController.create));
router.put('/:id/settle', authenticate, can('sales.rebates.settle'), validateUuidParams('id'), asyncHandler(rebateController.settle));
router.put('/:id/cancel', authenticate, can('sales.rebates.cancel'), validateUuidParams('id'), asyncHandler(rebateController.cancel));

export default router;
