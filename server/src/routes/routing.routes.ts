import { Router } from 'express';
import { routingController } from '../controllers/routing.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

// Postes de travail & gammes (mig 388) : admin / gérant.
const router = Router();
const AM = [authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER)];

router.get('/work-centers', ...AM, routingController.listWorkCenters);
router.post('/work-centers', ...AM, routingController.createWorkCenter);
router.post('/work-centers/:id/active', ...AM, routingController.setWorkCenterActive);
router.get('/', ...AM, routingController.listRoutings);
router.post('/', ...AM, routingController.createRouting);
router.get('/:id', ...AM, routingController.getRouting);
router.put('/:id', ...AM, routingController.updateRouting);
router.post('/:id/active', ...AM, routingController.setRoutingActive);
router.delete('/:id', ...AM, routingController.deleteRouting);

export default router;
