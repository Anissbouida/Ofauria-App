import { Router } from 'express';
import { fixedAssetController } from '../controllers/fixed-asset.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

// Immobilisations : reserve a l'admin (comme le reste du noyau comptable).
const router = Router();

router.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), fixedAssetController.list);
router.get('/:id/schedule', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), fixedAssetController.schedule);
router.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), fixedAssetController.create);
router.post('/run-depreciation', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), fixedAssetController.runDepreciation);
router.delete('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), fixedAssetController.remove);

export default router;
