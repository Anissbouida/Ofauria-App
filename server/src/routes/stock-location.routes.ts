import { Router } from 'express';
import { stockLocationController } from '../controllers/stock-location.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

// Référentiel d'emplacements de stock (épic labo L1, mig 424).
router.get('/', authenticate, asyncHandler(stockLocationController.list));
router.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(stockLocationController.create));
router.put('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(stockLocationController.update));
router.delete('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(stockLocationController.deactivate));

export default router;
