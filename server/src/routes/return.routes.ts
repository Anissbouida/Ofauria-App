import { Router } from 'express';
import { returnController } from '../controllers/return.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { createReturnSchema } from '../validators/return.validator.js';

const router = Router();

router.get('/', authenticate, can('pos.returns.view'), asyncHandler(returnController.list));
router.get('/search', authenticate, can('pos.returns.view'), asyncHandler(returnController.searchSale));
router.post('/', authenticate, can('pos.returns.create'), validate(createReturnSchema), asyncHandler(returnController.create));

export default router;
