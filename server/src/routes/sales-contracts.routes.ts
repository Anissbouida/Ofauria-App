import { Router } from 'express';
import { salesContractController } from '../controllers/sales-contract.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validateUuidParams } from '../middleware/validate.middleware.js';

/**
 * Phase 11 (D3-37) — contrats-cadres / commandes ouvertes.
 */
const router = Router();

router.get('/', authenticate, authorize(...ROLE_GROUPS.SALES), asyncHandler(salesContractController.list));
router.get('/:id', authenticate, authorize(...ROLE_GROUPS.SALES), validateUuidParams('id'), asyncHandler(salesContractController.get));
router.post('/', authenticate, authorize(...ROLE_GROUPS.SALES), asyncHandler(salesContractController.create));
router.post('/:id/releases', authenticate, authorize(...ROLE_GROUPS.SALES), validateUuidParams('id'), asyncHandler(salesContractController.addRelease));
router.put('/:id/close', authenticate, authorize(...ROLE_GROUPS.SALES), validateUuidParams('id'), asyncHandler(salesContractController.close));

export default router;
