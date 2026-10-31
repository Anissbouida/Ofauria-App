import { Router } from 'express';
import { supplierItemController } from '../controllers/supplier-item.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS } from '@ofauria/shared';

// Fiche article × fournisseur (mig 404) — Achats lot prix P1.
const router = Router();

router.get('/', authenticate, asyncHandler(supplierItemController.list));
router.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(supplierItemController.create));
router.patch('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(supplierItemController.update));
router.post('/:id/prefer', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(supplierItemController.prefer));
router.post('/:id/archive', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(supplierItemController.archive));
// Prix datés (mig 405) — lot prix P2
router.get('/:id/prices', authenticate, asyncHandler(supplierItemController.listPrices));
router.post('/:id/prices', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(supplierItemController.addPrice));

export default router;
