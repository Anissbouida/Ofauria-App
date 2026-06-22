import { Router } from 'express';
import { withholdingController } from '../controllers/withholding.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

// Retenues a la source : admin + gerant (comme le reste de la comptabilite).
const router = Router();

router.get('/types', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), withholdingController.listTypes);
router.patch('/types/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), withholdingController.updateType);
router.get('/to-remit', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), withholdingController.toRemit);
router.post('/reversement', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), withholdingController.reversement);

export default router;
