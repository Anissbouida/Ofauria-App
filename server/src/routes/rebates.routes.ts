import { Router } from 'express';
import { rebateController } from '../controllers/rebate.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validateUuidParams } from '../middleware/validate.middleware.js';

/**
 * Phase 11 (D5-12) — ristournes de fin d'année (RFA). Lecture : équipe de
 * vente ; créer / clôturer / annuler : direction.
 */
const router = Router();

router.get('/', authenticate, authorize(...ROLE_GROUPS.SALES), asyncHandler(rebateController.list));
router.get('/:id/compute', authenticate, authorize(...ROLE_GROUPS.SALES), validateUuidParams('id'), asyncHandler(rebateController.compute));
router.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(rebateController.create));
router.put('/:id/settle', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(rebateController.settle));
router.put('/:id/cancel', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(rebateController.cancel));

export default router;
