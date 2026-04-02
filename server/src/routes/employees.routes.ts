import { Router } from 'express';
import { employeeController, scheduleController } from '../controllers/employee.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';

const router = Router();

router.get('/', authenticate, authorize('admin', 'manager'), employeeController.list);
router.get('/:id', authenticate, authorize('admin', 'manager'), employeeController.getById);
router.post('/', authenticate, authorize('admin'), employeeController.create);
router.put('/:id', authenticate, authorize('admin', 'manager'), employeeController.update);
router.delete('/:id', authenticate, authorize('admin'), employeeController.remove);

export default router;

export const schedulesRouter = Router();

schedulesRouter.get('/', authenticate, authorize('admin', 'manager'), scheduleController.list);
schedulesRouter.post('/', authenticate, authorize('admin', 'manager'), scheduleController.create);
schedulesRouter.put('/:id', authenticate, authorize('admin', 'manager'), scheduleController.update);
schedulesRouter.delete('/:id', authenticate, authorize('admin', 'manager'), scheduleController.remove);
