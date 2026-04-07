import { Router } from 'express';
import { returnController } from '../controllers/return.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

router.get('/', authenticate, authorize(...ROLE_GROUPS.SALES), returnController.list);
router.get('/search', authenticate, authorize(...ROLE_GROUPS.SALES), returnController.searchSale);
router.post('/', authenticate, authorize(...ROLE_GROUPS.SALES), returnController.create);

export default router;
