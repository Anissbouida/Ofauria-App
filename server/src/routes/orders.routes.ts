import { Router } from 'express';
import { orderController } from '../controllers/order.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/', authenticate, orderController.list);
router.get('/:id', authenticate, orderController.getById);
router.post('/', authenticate, orderController.create);
router.put('/:id/status', authenticate, orderController.updateStatus);

export default router;
