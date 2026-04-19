import { Router } from 'express';
import { productionContenantController } from '../controllers/production-contenant.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Contenants CRUD (admin/manager)
router.get('/', authenticate, asyncHandler(productionContenantController.listContenants));
router.get('/:id', authenticate, asyncHandler(productionContenantController.getContenant));
router.post('/', authenticate, authorize('admin', 'manager'), asyncHandler(productionContenantController.createContenant));
router.put('/:id', authenticate, authorize('admin', 'manager'), asyncHandler(productionContenantController.updateContenant));
router.delete('/:id', authenticate, authorize('admin', 'manager'), asyncHandler(productionContenantController.deactivateContenant));

// Profils produit
router.get('/products/:productId', authenticate, asyncHandler(productionContenantController.getProfile));
router.put('/products/:productId', authenticate, authorize('admin', 'manager'), asyncHandler(productionContenantController.upsertProfile));
router.delete('/products/:productId', authenticate, authorize('admin', 'manager'), asyncHandler(productionContenantController.deleteProfile));

export default router;
