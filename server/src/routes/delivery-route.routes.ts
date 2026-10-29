import { Router } from 'express';
import { deliveryRouteController } from '../controllers/delivery-route.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

// Tournées de livraison (mig 387).
const router = Router();
const S = [authenticate, authorize(...ROLE_GROUPS.SALES)];

router.get('/', ...S, deliveryRouteController.list);
router.post('/', ...S, deliveryRouteController.create);
router.get('/available-notes', ...S, deliveryRouteController.availableNotes);
router.delete('/stops/:stopId', ...S, deliveryRouteController.removeStop);
router.post('/stops/:stopId/delivered', ...S, deliveryRouteController.markStop);
router.get('/:id', ...S, deliveryRouteController.getById);
router.post('/:id/status', ...S, deliveryRouteController.setStatus);
router.post('/:id/stops', ...S, deliveryRouteController.addStops);
router.post('/:id/reorder', ...S, deliveryRouteController.reorder);

export default router;
