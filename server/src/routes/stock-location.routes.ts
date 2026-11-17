import { Router } from 'express';
import { stockLocationController } from '../controllers/stock-location.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Référentiel d'emplacements de stock (épic labo L1, mig 424).
router.get('/', authenticate, asyncHandler(stockLocationController.list));
router.post('/', authenticate, can('stock.stock_locations.create'), asyncHandler(stockLocationController.create));
router.put('/:id', authenticate, can('stock.stock_locations.edit'), asyncHandler(stockLocationController.update));
router.delete('/:id', authenticate, can('stock.stock_locations.delete'), asyncHandler(stockLocationController.deactivate));

export default router;
