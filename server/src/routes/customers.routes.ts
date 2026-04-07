import { Router } from 'express';
import { customerController } from '../controllers/customer.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

router.get('/', authenticate, authorize(...ROLE_GROUPS.SALES), customerController.list);
router.get('/:id', authenticate, authorize(...ROLE_GROUPS.SALES), customerController.getById);
router.post('/', authenticate, authorize(...ROLE_GROUPS.SALES), customerController.create);
router.put('/:id', authenticate, authorize(...ROLE_GROUPS.SALES), customerController.update);
router.delete('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), customerController.remove);

export default router;
