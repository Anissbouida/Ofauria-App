import { Router } from 'express';
import { fixedAssetController } from '../controllers/fixed-asset.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLES } from '@ofauria/shared';

// Immobilisations : reserve a l'admin (comme le reste du noyau comptable).
const router = Router();

router.get('/', authenticate, authorize(ROLES.ADMIN), fixedAssetController.list);
router.get('/:id/schedule', authenticate, authorize(ROLES.ADMIN), fixedAssetController.schedule);
router.post('/', authenticate, authorize(ROLES.ADMIN), fixedAssetController.create);
router.post('/run-depreciation', authenticate, authorize(ROLES.ADMIN), fixedAssetController.runDepreciation);
router.delete('/:id', authenticate, authorize(ROLES.ADMIN), fixedAssetController.remove);

export default router;
