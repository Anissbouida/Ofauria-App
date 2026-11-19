import { Router } from 'express';
import { salesContractController } from '../controllers/sales-contract.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validateUuidParams } from '../middleware/validate.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { createSalesContractSchema, salesContractActionSchema, salesContractReleaseSchema } from '../validators/sales-terms.validator.js';

/**
 * Phase 11 (D3-37) — contrats-cadres / commandes ouvertes.
 */
const router = Router();

router.get('/', authenticate, can('sales.sales_contracts.view'), asyncHandler(salesContractController.list));
router.get('/:id', authenticate, can('sales.sales_contracts.view'), validateUuidParams('id'), asyncHandler(salesContractController.get));
router.post('/', authenticate, can('sales.sales_contracts.create'), validate(createSalesContractSchema), asyncHandler(salesContractController.create));
router.post('/:id/releases', authenticate, can('sales.sales_contracts.releases'), validateUuidParams('id'), validate(salesContractReleaseSchema), asyncHandler(salesContractController.addRelease));
router.put('/:id/close', authenticate, can('sales.sales_contracts.close'), validateUuidParams('id'), validate(salesContractActionSchema), asyncHandler(salesContractController.close));

export default router;
