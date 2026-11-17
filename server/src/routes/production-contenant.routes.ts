import { Router } from 'express';
import { productionContenantController } from '../controllers/production-contenant.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Contenants CRUD (admin/manager)
router.get('/', authenticate, asyncHandler(productionContenantController.listContenants));
router.get('/:id', authenticate, asyncHandler(productionContenantController.getContenant));
router.post('/', authenticate, can('production.contenants.create'), asyncHandler(productionContenantController.createContenant));
router.put('/:id', authenticate, can('production.contenants.edit'), asyncHandler(productionContenantController.updateContenant));
router.delete('/:id', authenticate, can('production.contenants.delete'), asyncHandler(productionContenantController.deactivateContenant));

// Actions en masse sur une selection (admin/manager)
router.post('/bulk-deactivate', authenticate, can('production.contenants.bulk_deactivate'), asyncHandler(productionContenantController.bulkDeactivate));
router.post('/bulk-delete', authenticate, can('production.contenants.bulk_delete'), asyncHandler(productionContenantController.bulkDelete));

// Profils produit
router.get('/products/:productId', authenticate, asyncHandler(productionContenantController.getProfile));
router.put('/products/:productId', authenticate, can('production.contenants.products'), asyncHandler(productionContenantController.upsertProfile));
router.delete('/products/:productId', authenticate, can('production.contenants.delete'), asyncHandler(productionContenantController.deleteProfile));

export default router;
