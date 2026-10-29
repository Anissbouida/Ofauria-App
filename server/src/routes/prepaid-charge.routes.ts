import { Router } from 'express';
import { prepaidChargeController } from '../controllers/prepaid-charge.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

// Charges constatées d'avance (mig 380) : réservé admin/gérant (noyau comptable).
const router = Router();

router.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), prepaidChargeController.list);
router.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), prepaidChargeController.create);
router.post('/recognize', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), prepaidChargeController.recognize);
router.get('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), prepaidChargeController.getById);

export default router;
