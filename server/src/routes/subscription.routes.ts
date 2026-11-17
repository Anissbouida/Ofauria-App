import { Router } from 'express';
import { subscriptionController } from '../controllers/subscription.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';

// Abonnements / facturation récurrente (mig 382) : réservé admin/gérant.
const router = Router();
router.get('/', authenticate, can('sales.subscriptions.view'), subscriptionController.list);
router.post('/', authenticate, can('sales.subscriptions.create'), subscriptionController.create);
router.post('/generate', authenticate, can('sales.subscriptions.generate'), subscriptionController.generate);
router.get('/:id', authenticate, can('sales.subscriptions.view'), subscriptionController.getById);
router.post('/:id/status', authenticate, can('sales.subscriptions.status'), subscriptionController.setStatus);
export default router;
