import { Router } from 'express';
import { cashRegisterController } from '../controllers/cash-register.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/', authenticate, cashRegisterController.list);
router.get('/current', authenticate, cashRegisterController.currentSession);
router.get('/:id', authenticate, cashRegisterController.getById);
router.post('/open', authenticate, cashRegisterController.open);
router.post('/close', authenticate, cashRegisterController.close);
router.post('/:id/submit', authenticate, cashRegisterController.submitAmount);

export default router;
