import { Router } from 'express';
import { supplierItemController } from '../controllers/supplier-item.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

// Fiche article × fournisseur (mig 404) — Achats lot prix P1.
const router = Router();

router.get('/', authenticate, asyncHandler(supplierItemController.list));
router.post('/', authenticate, can('purchasing.supplier_items.create'), asyncHandler(supplierItemController.create));
router.patch('/:id', authenticate, can('purchasing.supplier_items.edit'), asyncHandler(supplierItemController.update));
router.post('/:id/prefer', authenticate, can('purchasing.supplier_items.prefer'), asyncHandler(supplierItemController.prefer));
router.post('/:id/archive', authenticate, can('purchasing.supplier_items.archive'), asyncHandler(supplierItemController.archive));
// Prix datés (mig 405) — lot prix P2
router.get('/:id/prices', authenticate, asyncHandler(supplierItemController.listPrices));
router.post('/:id/prices', authenticate, can('purchasing.supplier_items.prices'), asyncHandler(supplierItemController.addPrice));

export default router;
