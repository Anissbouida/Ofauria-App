import { Router } from 'express';
import { categoryController } from '../controllers/category.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';

const router = Router();

router.get('/', authenticate, categoryController.list);
router.post('/', authenticate, authorize('admin', 'manager'), categoryController.create);
router.put('/:id', authenticate, authorize('admin', 'manager'), categoryController.update);
router.delete('/:id', authenticate, authorize('admin'), categoryController.remove);

export default router;
