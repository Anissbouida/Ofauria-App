import { Router } from 'express';
import { cashRegisterController } from '../controllers/cash-register.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

router.get('/', authenticate, authorize(...ROLE_GROUPS.CASH), cashRegisterController.list);
router.get('/current', authenticate, authorize(...ROLE_GROUPS.CASH), cashRegisterController.currentSession);
router.get('/last-amount', authenticate, authorize(...ROLE_GROUPS.CASH), cashRegisterController.lastClosedAmount);
router.get('/:id', authenticate, authorize(...ROLE_GROUPS.CASH), cashRegisterController.getById);
router.get('/:id/inventory', authenticate, authorize(...ROLE_GROUPS.CASH), cashRegisterController.getInventoryItems);
router.post('/open', authenticate, authorize(...ROLE_GROUPS.CASH), cashRegisterController.open);
router.post('/close', authenticate, authorize(...ROLE_GROUPS.CASH), cashRegisterController.close);
router.post('/:id/submit', authenticate, authorize(...ROLE_GROUPS.CASH), cashRegisterController.submitAmount);

export default router;
