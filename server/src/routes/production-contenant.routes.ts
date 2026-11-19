import { Router } from 'express';
import { productionContenantController } from '../controllers/production-contenant.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { createContenantBody, updateContenantBody, bulkContenantIdsBody, upsertProfileBody } from '../validators/production-flow.validator.js';

const router = Router();

// Contenants CRUD (admin/manager)
router.get('/', authenticate, asyncHandler(productionContenantController.listContenants));
router.get('/:id', authenticate, asyncHandler(productionContenantController.getContenant));
router.post('/', authenticate, can('production.contenants.create'), validate(createContenantBody), asyncHandler(productionContenantController.createContenant));
router.put('/:id', authenticate, validateUuidParams('id'), can('production.contenants.edit'), validate(updateContenantBody), asyncHandler(productionContenantController.updateContenant));
router.delete('/:id', authenticate, can('production.contenants.delete'), asyncHandler(productionContenantController.deactivateContenant));

// Actions en masse sur une selection (admin/manager)
router.post('/bulk-deactivate', authenticate, can('production.contenants.bulk_deactivate'), validate(bulkContenantIdsBody), asyncHandler(productionContenantController.bulkDeactivate));
router.post('/bulk-delete', authenticate, can('production.contenants.bulk_delete'), validate(bulkContenantIdsBody), asyncHandler(productionContenantController.bulkDelete));

// Profils produit
router.get('/products/:productId', authenticate, asyncHandler(productionContenantController.getProfile));
router.put('/products/:productId', authenticate, validateUuidParams('productId'), can('production.contenants.products'), validate(upsertProfileBody), asyncHandler(productionContenantController.upsertProfile));
router.delete('/products/:productId', authenticate, can('production.contenants.delete'), asyncHandler(productionContenantController.deleteProfile));

export default router;
