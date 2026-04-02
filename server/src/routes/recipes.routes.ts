import { Router } from 'express';
import { recipeController } from '../controllers/recipe.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';

const router = Router();

router.get('/', authenticate, recipeController.list);
router.get('/:id', authenticate, recipeController.getById);
router.post('/', authenticate, authorize('admin', 'manager'), recipeController.create);
router.delete('/:id', authenticate, authorize('admin'), recipeController.remove);

export default router;
