import { Router } from 'express';
import { customerController } from '../controllers/customer.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = Router();

import { authorize } from '../middleware/role.middleware.js';

router.get('/', authenticate, customerController.list);
router.get('/:id', authenticate, customerController.getById);
router.post('/', authenticate, customerController.create);
router.put('/:id', authenticate, customerController.update);
router.delete('/:id', authenticate, authorize('admin', 'manager'), customerController.remove);

export default router;
