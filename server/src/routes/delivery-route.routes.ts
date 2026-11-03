import { Router } from 'express';
import { deliveryRouteController } from '../controllers/delivery-route.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';
import { asyncHandler } from '../middleware/asyncHandler.js';

// Tournées de livraison (mig 387).
const router = Router();
const S = [authenticate, authorize(...ROLE_GROUPS.SALES)];

router.get('/', ...S, asyncHandler(deliveryRouteController.list));
router.post('/', ...S, asyncHandler(deliveryRouteController.create));
router.get('/available-notes', ...S, asyncHandler(deliveryRouteController.availableNotes));
router.delete('/stops/:stopId', ...S, asyncHandler(deliveryRouteController.removeStop));
router.post('/stops/:stopId/delivered', ...S, asyncHandler(deliveryRouteController.markStop));
router.get('/:id', ...S, asyncHandler(deliveryRouteController.getById));
router.post('/:id/status', ...S, asyncHandler(deliveryRouteController.setStatus));
router.post('/:id/stops', ...S, asyncHandler(deliveryRouteController.addStops));
router.post('/:id/reorder', ...S, asyncHandler(deliveryRouteController.reorder));

export default router;
