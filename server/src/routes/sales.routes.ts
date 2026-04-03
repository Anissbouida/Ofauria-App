import { Router } from 'express';
import { saleController } from '../controllers/sale.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/', authenticate, saleController.list);
router.get('/today', authenticate, saleController.todayStats);
router.get('/:id', authenticate, saleController.getById);
router.post('/checkout', authenticate, saleController.checkout);

export default router;
