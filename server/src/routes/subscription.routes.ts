import { Router } from 'express';
import { subscriptionController } from '../controllers/subscription.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { createSubscriptionSchema, generateSubscriptionsSchema, subscriptionStatusSchema } from '../validators/sales-terms.validator.js';

// Abonnements / facturation récurrente (mig 382) : réservé admin/gérant.
const router = Router();
router.get('/', authenticate, can('sales.subscriptions.view'), subscriptionController.list);
router.post('/', authenticate, can('sales.subscriptions.create'), validate(createSubscriptionSchema), subscriptionController.create);
router.post('/generate', authenticate, can('sales.subscriptions.generate'), validate(generateSubscriptionsSchema), subscriptionController.generate);
router.get('/:id', authenticate, can('sales.subscriptions.view'), subscriptionController.getById);
router.post('/:id/status', authenticate, can('sales.subscriptions.status'), validate(subscriptionStatusSchema), subscriptionController.setStatus);
export default router;
