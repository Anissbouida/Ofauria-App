import { Router } from 'express';
import { ROLE_GROUPS } from '@ofauria/shared';
import { proReturnController } from '../controllers/pro-return.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

// Retours clients professionnels (phase 7.5) — direction.
const router = Router();
const staff = [authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER)];
router.get('/', ...staff, asyncHandler(proReturnController.list));
router.get('/:id', ...staff, asyncHandler(proReturnController.get));
router.post('/', ...staff, asyncHandler(proReturnController.create));
export default router;
