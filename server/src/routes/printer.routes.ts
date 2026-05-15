import { Router } from 'express';
import { printerController } from '../controllers/printer.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLES, ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

// CRUD config — admin/manager
router.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), printerController.list);
router.post('/', authenticate, authorize(ROLES.ADMIN), printerController.create);
router.put('/:id', authenticate, authorize(ROLES.ADMIN), printerController.update);
router.delete('/:id', authenticate, authorize(ROLES.ADMIN), printerController.remove);

// Actions
router.post('/:id/test', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), printerController.test);
router.post('/:id/open-drawer', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), printerController.openDrawer);

export default router;
