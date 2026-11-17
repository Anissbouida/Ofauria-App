import { Router } from 'express';
import { sachetConfigController } from '../controllers/sachet-config.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { authorizeSettings } from '../middleware/settings-access.middleware.js';

const router = Router();

router.get('/', authenticate, sachetConfigController.get);
router.put('/', authenticate, authorizeSettings('sachets', 'edit'), sachetConfigController.update);
router.post('/suggest', authenticate, sachetConfigController.suggest);
router.get('/report', authenticate, can('production.sachet_config.view'), sachetConfigController.report);

export default router;
