import { Router } from 'express';
import { inventoryController, ingredientController } from '../controllers/inventory.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLES, ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

router.get('/', authenticate, inventoryController.list);
router.get('/alerts', authenticate, inventoryController.alerts);
router.post('/restock', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), inventoryController.restock);
router.post('/adjust', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), inventoryController.adjust);
router.put('/threshold', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), inventoryController.updateThreshold);
router.get('/transactions', authenticate, inventoryController.transactions);

export default router;

export const ingredientsRouter = Router();

ingredientsRouter.get('/', authenticate, ingredientController.list);
ingredientsRouter.get('/:id', authenticate, ingredientController.getById);
ingredientsRouter.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), ingredientController.create);
ingredientsRouter.put('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), ingredientController.update);
ingredientsRouter.delete('/:id', authenticate, authorize(ROLES.ADMIN), ingredientController.remove);
