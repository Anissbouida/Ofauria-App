import { Router } from 'express';
import { salesTargetController } from '../controllers/sales-target.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validateUuidParams } from '../middleware/validate.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { salesTargetSchema } from '../validators/sales-terms.validator.js';

/**
 * Phase 11 (D3-13) — objectifs par commercial. Lecture : équipe de vente ;
 * poser/retirer un objectif : direction.
 */
const router = Router();

router.get('/', authenticate, can('sales.sales_targets.view'), asyncHandler(salesTargetController.report));
router.get('/salespeople', authenticate, can('sales.sales_targets.view'), asyncHandler(salesTargetController.salespeople));
router.post('/', authenticate, can('sales.sales_targets.create'), validate(salesTargetSchema), asyncHandler(salesTargetController.upsert));
router.delete('/:id', authenticate, can('sales.sales_targets.delete'), validateUuidParams('id'), asyncHandler(salesTargetController.remove));

export default router;
