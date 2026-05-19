import { Router } from 'express';
import { sachetConfigController } from '../controllers/sachet-config.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';

const router = Router();

router.get('/', authenticate, sachetConfigController.get);
router.put('/', authenticate, authorize('admin'), sachetConfigController.update);
router.post('/suggest', authenticate, sachetConfigController.suggest);
router.get('/report', authenticate, authorize('admin', 'manager'), sachetConfigController.report);

export default router;
