import { Router } from 'express';
import { reportsController } from '../controllers/reports.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';

const router = Router();

router.get('/dashboard', authenticate, reportsController.dashboard);
router.get('/sales', authenticate, authorize('admin', 'manager'), reportsController.sales);
router.get('/products', authenticate, authorize('admin', 'manager'), reportsController.productPerformance);

export default router;
