import { Router } from 'express';
import { productionController } from '../controllers/production.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';

const router = Router();

const ALL_PRODUCTION = ['admin', 'manager', 'baker', 'pastry_chef', 'viennoiserie', 'cashier', 'saleswoman'];
const CHEFS_ONLY = ['admin', 'manager', 'baker', 'pastry_chef', 'viennoiserie'];

router.get('/', authenticate, productionController.list);
router.get('/:id', authenticate, productionController.getById);
router.post('/', authenticate, authorize(...ALL_PRODUCTION), productionController.create);
router.put('/:id/items', authenticate, authorize(...ALL_PRODUCTION), productionController.updateItems);
router.post('/:id/confirm', authenticate, authorize(...CHEFS_ONLY), productionController.confirm);
router.post('/:id/start', authenticate, authorize(...CHEFS_ONLY), productionController.start);
router.post('/:id/complete', authenticate, authorize(...CHEFS_ONLY), productionController.complete);
router.delete('/:id', authenticate, authorize(...ALL_PRODUCTION), productionController.remove);

export default router;
