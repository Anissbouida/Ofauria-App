import { Router } from 'express';
import { proReturnController } from '../controllers/pro-return.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { createProReturnSchema } from '../validators/sales-flow.validator.js';

// Retours clients professionnels (phase 7.5) — direction.
const router = Router();
router.get('/', authenticate, can('sales.pro_returns.view'), asyncHandler(proReturnController.list));
router.get('/:id', authenticate, can('sales.pro_returns.view'), asyncHandler(proReturnController.get));
router.post('/', authenticate, can('sales.pro_returns.create'), validate(createProReturnSchema), asyncHandler(proReturnController.create));
export default router;
