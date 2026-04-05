import { Router } from 'express';
import { employeeController, scheduleController, attendanceController, leaveController, payrollController } from '../controllers/employee.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';

const ADMIN_MANAGER = ['admin', 'manager'] as const;
const router = Router();

router.get('/', authenticate, authorize(...ADMIN_MANAGER), employeeController.list);
router.get('/:id', authenticate, authorize(...ADMIN_MANAGER), employeeController.getById);
router.post('/', authenticate, authorize('admin'), employeeController.create);
router.put('/:id', authenticate, authorize(...ADMIN_MANAGER), employeeController.update);
router.delete('/:id', authenticate, authorize('admin'), employeeController.remove);

export default router;

// Schedules
export const schedulesRouter = Router();
schedulesRouter.get('/', authenticate, authorize(...ADMIN_MANAGER), scheduleController.list);
schedulesRouter.post('/', authenticate, authorize(...ADMIN_MANAGER), scheduleController.create);
schedulesRouter.put('/:id', authenticate, authorize(...ADMIN_MANAGER), scheduleController.update);
schedulesRouter.delete('/:id', authenticate, authorize(...ADMIN_MANAGER), scheduleController.remove);

// Attendance
export const attendanceRouter = Router();
attendanceRouter.get('/', authenticate, authorize(...ADMIN_MANAGER), attendanceController.list);
attendanceRouter.get('/summary', authenticate, authorize(...ADMIN_MANAGER), attendanceController.monthlySummary);
attendanceRouter.post('/', authenticate, authorize(...ADMIN_MANAGER), attendanceController.upsert);
attendanceRouter.post('/bulk', authenticate, authorize(...ADMIN_MANAGER), attendanceController.bulkUpsert);
attendanceRouter.delete('/:id', authenticate, authorize(...ADMIN_MANAGER), attendanceController.remove);

// Leaves
export const leavesRouter = Router();
leavesRouter.get('/', authenticate, authorize(...ADMIN_MANAGER), leaveController.list);
leavesRouter.get('/balance', authenticate, authorize(...ADMIN_MANAGER), leaveController.balance);
leavesRouter.post('/', authenticate, authorize(...ADMIN_MANAGER), leaveController.create);
leavesRouter.post('/:id/approve', authenticate, authorize(...ADMIN_MANAGER), leaveController.approve);
leavesRouter.post('/:id/reject', authenticate, authorize(...ADMIN_MANAGER), leaveController.reject);
leavesRouter.delete('/:id', authenticate, authorize(...ADMIN_MANAGER), leaveController.remove);

// Payroll
export const payrollRouter = Router();
payrollRouter.get('/', authenticate, authorize('admin'), payrollController.list);
payrollRouter.post('/generate', authenticate, authorize('admin'), payrollController.generate);
payrollRouter.put('/:id', authenticate, authorize('admin'), payrollController.update);
payrollRouter.post('/:id/pay', authenticate, authorize('admin'), payrollController.markPaid);
