import { Router } from 'express';
import { costCenterController } from '../controllers/cost-center.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

// Centres de coûts (mig 386) : admin / gérant (noyau comptable).
const router = Router();
const AM = [authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER)];

router.get('/', ...AM, costCenterController.list);
router.post('/', ...AM, costCenterController.create);
router.get('/report', ...AM, costCenterController.report);
router.get('/invoices', ...AM, costCenterController.invoices);
router.post('/assign', ...AM, costCenterController.assign);
router.post('/:id/active', ...AM, costCenterController.setActive);

export default router;
