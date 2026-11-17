import { Router } from 'express';
import { categoryController } from '../controllers/category.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';

const router = Router();

router.get('/', authenticate, categoryController.list);
router.post('/', authenticate, can('products.categories.create'), categoryController.create);
router.put('/:id', authenticate, can('products.categories.edit'), categoryController.update);
router.delete('/:id', authenticate, can('products.categories.delete'), categoryController.remove);

export default router;
