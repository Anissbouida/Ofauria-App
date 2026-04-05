import { Router } from 'express';
import { inventoryController, ingredientController } from '../controllers/inventory.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';

const router = Router();

router.get('/', authenticate, inventoryController.list);
router.get('/alerts', authenticate, inventoryController.alerts);
router.post('/restock', authenticate, authorize('admin', 'manager', 'baker', 'pastry_chef', 'viennoiserie'), inventoryController.restock);
router.post('/adjust', authenticate, authorize('admin', 'manager'), inventoryController.adjust);
router.put('/threshold', authenticate, authorize('admin', 'manager'), inventoryController.updateThreshold);
router.get('/transactions', authenticate, inventoryController.transactions);

export default router;

export const ingredientsRouter = Router();

ingredientsRouter.get('/', authenticate, ingredientController.list);
ingredientsRouter.get('/:id', authenticate, ingredientController.getById);
ingredientsRouter.post('/', authenticate, authorize('admin', 'manager'), ingredientController.create);
ingredientsRouter.put('/:id', authenticate, authorize('admin', 'manager'), ingredientController.update);
ingredientsRouter.delete('/:id', authenticate, authorize('admin'), ingredientController.remove);
