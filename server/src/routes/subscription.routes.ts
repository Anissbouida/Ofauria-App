import { Router } from 'express';
import { subscriptionController } from '../controllers/subscription.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

// Abonnements / facturation récurrente (mig 382) : réservé admin/gérant.
const router = Router();
router.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), subscriptionController.list);
router.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), subscriptionController.create);
router.post('/generate', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), subscriptionController.generate);
router.get('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), subscriptionController.getById);
router.post('/:id/status', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), subscriptionController.setStatus);
export default router;
