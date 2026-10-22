import { Router } from 'express';
import { userController } from '../controllers/user.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { roleController } from '../controllers/role.controller.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Roles editables et mode de controle des droits (mig 330) : declares avant /:id.
router.get('/roles', authenticate, authorize('admin'), asyncHandler(roleController.list));
router.post('/roles', authenticate, authorize('admin'), asyncHandler(roleController.create));
router.get('/roles/:code/permissions', authenticate, authorize('admin'), asyncHandler(roleController.permissions));
router.put('/roles/:code/permissions', authenticate, authorize('admin'), asyncHandler(roleController.setPermissions));
router.put('/roles/:code', authenticate, authorize('admin'), asyncHandler(roleController.update));
router.delete('/roles/:code', authenticate, authorize('admin'), asyncHandler(roleController.remove));
router.get('/security', authenticate, authorize('admin'), asyncHandler(roleController.security));
router.put('/security', authenticate, authorize('admin'), asyncHandler(roleController.setSecurityMode));

router.get('/', authenticate, authorize('admin'), userController.list);
router.post('/', authenticate, authorize('admin'), userController.create);
router.put('/:id', authenticate, authorize('admin'), userController.update);
router.delete('/:id', authenticate, authorize('admin'), userController.remove);

// Permissions
router.get('/me/permissions', authenticate, userController.myPermissions);
router.get('/:id/permissions', authenticate, authorize('admin'), userController.getPermissions);
router.put('/:id/permissions', authenticate, authorize('admin'), userController.setPermissions);

export default router;
