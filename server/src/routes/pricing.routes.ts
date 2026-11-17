import { Router } from 'express';
import { pricingController } from '../controllers/pricing.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

// Listes de prix (phase 6.1–6.3). Résolution ouverte aux vendeurs (prix de ligne) ;
// administration réservée à la direction.
const router = Router();

router.get('/resolve', authenticate, can('sales.pricing.resolve.view'), asyncHandler(pricingController.resolve));
router.get('/history', authenticate, can('sales.pricing.history.view'), asyncHandler(pricingController.history));
router.post('/bulk-update', authenticate, can('sales.pricing.bulk_update'), asyncHandler(pricingController.bulkUpdate));
router.get('/lists', authenticate, can('sales.pricing.lists.view'), asyncHandler(pricingController.list));
router.get('/lists/:id', authenticate, can('sales.pricing.lists.view'), asyncHandler(pricingController.get));
router.post('/lists', authenticate, can('sales.pricing.lists'), asyncHandler(pricingController.create));
router.put('/lists/:id', authenticate, can('sales.pricing.lists'), asyncHandler(pricingController.update));
router.delete('/lists/:id', authenticate, can('sales.pricing.delete'), asyncHandler(pricingController.remove));
router.post('/lists/:id/items', authenticate, can('sales.pricing.items'), asyncHandler(pricingController.setItem));
router.delete('/lists/:id/items/:itemId', authenticate, can('sales.pricing.delete'), asyncHandler(pricingController.removeItem));

export default router;
