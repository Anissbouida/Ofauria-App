import { Router } from 'express';
import { ROLE_GROUPS } from '@ofauria/shared';
import { pricingController } from '../controllers/pricing.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

// Listes de prix (phase 6.1–6.3). Résolution ouverte aux vendeurs (prix de ligne) ;
// administration réservée à la direction.
const router = Router();

router.get('/resolve', authenticate, authorize(...ROLE_GROUPS.SALES), asyncHandler(pricingController.resolve));
router.get('/lists', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(pricingController.list));
router.get('/lists/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(pricingController.get));
router.post('/lists', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(pricingController.create));
router.put('/lists/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(pricingController.update));
router.delete('/lists/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(pricingController.remove));
router.post('/lists/:id/items', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(pricingController.setItem));
router.delete('/lists/:id/items/:itemId', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(pricingController.removeItem));

export default router;
