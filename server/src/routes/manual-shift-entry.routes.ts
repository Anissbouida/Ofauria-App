import { Router } from 'express';
import { manualShiftEntryController } from '../controllers/manual-shift-entry.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

router.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), manualShiftEntryController.list);
router.put('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), manualShiftEntryController.upsert);

export default router;
