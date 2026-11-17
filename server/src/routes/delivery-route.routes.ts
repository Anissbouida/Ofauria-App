import { Router } from 'express';
import { deliveryRouteController } from '../controllers/delivery-route.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

// Tournées de livraison (mig 387).
const router = Router();

router.get('/', authenticate, can('sales.delivery_routes.view'), asyncHandler(deliveryRouteController.list));
router.post('/', authenticate, can('sales.delivery_routes.create'), asyncHandler(deliveryRouteController.create));
router.get('/available-notes', authenticate, can('sales.delivery_routes.view'), asyncHandler(deliveryRouteController.availableNotes));
router.delete('/stops/:stopId', authenticate, can('sales.delivery_routes.delete'), asyncHandler(deliveryRouteController.removeStop));
router.post('/stops/:stopId/delivered', authenticate, can('sales.delivery_routes.delivered'), asyncHandler(deliveryRouteController.markStop));
router.get('/:id', authenticate, can('sales.delivery_routes.view'), asyncHandler(deliveryRouteController.getById));
router.post('/:id/status', authenticate, can('sales.delivery_routes.status'), asyncHandler(deliveryRouteController.setStatus));
router.post('/:id/stops', authenticate, can('sales.delivery_routes.stops'), asyncHandler(deliveryRouteController.addStops));
router.post('/:id/reorder', authenticate, can('sales.delivery_routes.reorder'), asyncHandler(deliveryRouteController.reorder));

export default router;
