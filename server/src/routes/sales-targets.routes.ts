import { Router } from 'express';
import { salesTargetController } from '../controllers/sales-target.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validateUuidParams } from '../middleware/validate.middleware.js';

/**
 * Phase 11 (D3-13) — objectifs par commercial. Lecture : équipe de vente ;
 * poser/retirer un objectif : direction.
 */
const router = Router();

router.get('/', authenticate, authorize(...ROLE_GROUPS.SALES), asyncHandler(salesTargetController.report));
router.get('/salespeople', authenticate, authorize(...ROLE_GROUPS.SALES), asyncHandler(salesTargetController.salespeople));
router.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(salesTargetController.upsert));
router.delete('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validateUuidParams('id'), asyncHandler(salesTargetController.remove));

export default router;
