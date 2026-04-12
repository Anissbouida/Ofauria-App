import { Router } from 'express';
import { recipeController } from '../controllers/recipe.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { createRecipeSchema, updateRecipeSchema } from '../validators/recipe.validator.js';
import { ROLES, ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

router.get('/', authenticate, recipeController.list);
router.get('/base', authenticate, recipeController.baseRecipes);
router.get('/by-product/:productId', authenticate, recipeController.getByProductId);
router.get('/:id', authenticate, recipeController.getById);
router.get('/:id/versions', authenticate, recipeController.versions);
router.post('/', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), validate(createRecipeSchema), recipeController.create);
router.put('/:id', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), validate(updateRecipeSchema), recipeController.update);
router.delete('/:id', authenticate, authorize(ROLES.ADMIN), recipeController.remove);

export default router;
