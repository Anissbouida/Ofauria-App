import { Router } from 'express';
import { lotThermalController } from '../controllers/lot-thermal.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.get('/freezable', authenticate, asyncHandler(lotThermalController.listFreezable));

// État thermique des lots (épic labo L4, mig 426). :kind = semi | product.
router.post('/:kind/:id/freeze', authenticate, can('production.lot_thermal.freeze'), asyncHandler(lotThermalController.freeze));
router.post('/:kind/:id/thaw', authenticate, can('production.lot_thermal.thaw'), asyncHandler(lotThermalController.thaw));

export default router;
