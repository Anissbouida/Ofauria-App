import { Router } from 'express';
import { userController } from '../controllers/user.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';

const router = Router();

router.get('/', authenticate, authorize('admin'), userController.list);
router.post('/', authenticate, authorize('admin'), userController.create);
router.put('/:id', authenticate, authorize('admin'), userController.update);
router.delete('/:id', authenticate, authorize('admin'), userController.remove);

// Permissions
router.get('/me/permissions', authenticate, userController.myPermissions);
router.get('/:id/permissions', authenticate, authorize('admin'), userController.getPermissions);
router.put('/:id/permissions', authenticate, authorize('admin'), userController.setPermissions);

export default router;
