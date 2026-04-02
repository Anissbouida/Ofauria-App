import { Router } from 'express';
import { customerController } from '../controllers/customer.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/', authenticate, customerController.list);
router.get('/:id', authenticate, customerController.getById);
router.post('/', authenticate, customerController.create);
router.put('/:id', authenticate, customerController.update);

export default router;
