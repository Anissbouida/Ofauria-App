import { Router } from 'express';
import { stockLocationController } from '../controllers/stock-location.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { stockLocationRepository } from '../repositories/stock-location.repository.js';
import { stockLocationCreateSchema, stockLocationUpdateSchema } from '../validators/stock-flow.validator.js';

const router = Router();

// Référentiel d'emplacements de stock (épic labo L1, mig 424).
router.get('/', authenticate, asyncHandler(stockLocationController.list));
// Stock par emplacement et répartition d'un lot (M6-02).
router.get('/stock', authenticate, asyncHandler(async (req, res) => {
  const user = (req as never as { user: { storeId?: string | null } }).user;
  res.json({ success: true, data: await stockLocationRepository.stockByLocation(user.storeId ?? null) });
}));
router.get('/lots/:lotId', authenticate, validateUuidParams('lotId'), asyncHandler(async (req, res) => {
  res.json({ success: true, data: await stockLocationRepository.lotLocations(req.params.lotId as string) });
}));
router.post('/', authenticate, can('stock.stock_locations.create'), validate(stockLocationCreateSchema), asyncHandler(stockLocationController.create));
router.put('/:id', authenticate, can('stock.stock_locations.edit'), validateUuidParams('id'), validate(stockLocationUpdateSchema), asyncHandler(stockLocationController.update));
router.delete('/:id', authenticate, can('stock.stock_locations.delete'), asyncHandler(stockLocationController.deactivate));

export default router;
