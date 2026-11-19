import { Router } from 'express';
import { productTransferController } from '../controllers/product-transfer.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate } from '../middleware/validate.middleware.js';
import { productTransferSchema } from '../validators/stock-flow.validator.js';

// Transferts de produits finis entre sites (phase 7.4) — direction.
const router = Router();
router.get('/', authenticate, can('sales.product_transfers.view'), asyncHandler(productTransferController.list));
router.get('/:id', authenticate, can('sales.product_transfers.view'), asyncHandler(productTransferController.get));
router.post('/', authenticate, can('sales.product_transfers.create'), validate(productTransferSchema), asyncHandler(productTransferController.create));
export default router;
