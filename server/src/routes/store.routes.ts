import { Router } from 'express';
import { storeController } from '../controllers/store.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLES } from '@ofauria/shared';

const router = Router();

router.get('/', authenticate, storeController.list);
router.get('/:id', authenticate, storeController.getById);
router.post('/', authenticate, authorize(ROLES.ADMIN), storeController.create);
router.put('/:id', authenticate, authorize(ROLES.ADMIN), storeController.update);
router.delete('/:id', authenticate, authorize(ROLES.ADMIN), storeController.remove);

export default router;
