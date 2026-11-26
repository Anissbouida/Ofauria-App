import { Router } from 'express';
import { deliveryRouteController } from '../controllers/delivery-route.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate } from '../middleware/validate.middleware.js';
import { deliveryRouteRepository } from '../repositories/delivery-route.repository.js';
import { createDeliveryRouteSchema, deliveryRouteReorderSchema, deliveryRouteStatusSchema, deliveryRouteStopsSchema, deliveryStopDeliveredSchema } from '../validators/delivery-route.validator.js';

// Tournées de livraison (mig 387).
const router = Router();

router.get('/', authenticate, can('sales.delivery_routes.view'), asyncHandler(deliveryRouteController.list));
router.post('/', authenticate, can('sales.delivery_routes.create'), validate(createDeliveryRouteSchema), asyncHandler(deliveryRouteController.create));
router.get('/vehicles', authenticate, can('sales.delivery_routes.view'), asyncHandler(async (_req, res) => { res.json({ success: true, data: await deliveryRouteRepository.vehicles() }); }));
router.get('/available-notes', authenticate, can('sales.delivery_routes.view'), asyncHandler(deliveryRouteController.availableNotes));
router.delete('/stops/:stopId', authenticate, can('sales.delivery_routes.delete'), asyncHandler(deliveryRouteController.removeStop));
router.post('/stops/:stopId/delivered', authenticate, can('sales.delivery_routes.delivered'), validate(deliveryStopDeliveredSchema), asyncHandler(deliveryRouteController.markStop));
router.get('/:id', authenticate, can('sales.delivery_routes.view'), asyncHandler(deliveryRouteController.getById));
router.post('/:id/status', authenticate, can('sales.delivery_routes.status'), validate(deliveryRouteStatusSchema), asyncHandler(deliveryRouteController.setStatus));
router.post('/:id/stops', authenticate, can('sales.delivery_routes.stops'), validate(deliveryRouteStopsSchema), asyncHandler(deliveryRouteController.addStops));
router.post('/:id/reorder', authenticate, can('sales.delivery_routes.reorder'), validate(deliveryRouteReorderSchema), asyncHandler(deliveryRouteController.reorder));

export default router;
