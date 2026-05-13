import { Router } from 'express';
import { reportsController } from '../controllers/reports.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';

const router = Router();

router.get('/dashboard', authenticate, authorize('admin', 'manager'), reportsController.dashboard);
router.get('/sales', authenticate, authorize('admin', 'manager'), reportsController.sales);
router.get('/products', authenticate, authorize('admin', 'manager'), reportsController.productPerformance);
router.get('/cost-summary', authenticate, authorize('admin', 'manager'), reportsController.costSummary);
router.get('/menu-engineering', authenticate, authorize('admin', 'manager'), reportsController.menuEngineering);

export default router;
