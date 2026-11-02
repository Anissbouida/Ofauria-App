import { Router } from 'express';
import { lotThermalController } from '../controllers/lot-thermal.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

router.get('/freezable', authenticate, asyncHandler(lotThermalController.listFreezable));

// État thermique des lots (épic labo L4, mig 426). :kind = semi | product.
router.post('/:kind/:id/freeze', authenticate, authorize(...ROLE_GROUPS.PRODUCTION, 'magasinier'), asyncHandler(lotThermalController.freeze));
router.post('/:kind/:id/thaw', authenticate, authorize(...ROLE_GROUPS.PRODUCTION, 'magasinier'), asyncHandler(lotThermalController.thaw));

export default router;
