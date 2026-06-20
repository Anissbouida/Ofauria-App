import { Router, json as expressJson } from 'express';
import { employeeController, scheduleController, attendanceController, leaveController, payrollController, shiftController, weeklyPayrollController } from '../controllers/employee.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLES, ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

router.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), employeeController.list);
router.get('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), employeeController.getById);
router.post('/', authenticate, authorize(ROLES.ADMIN), employeeController.create);
router.put('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), employeeController.update);
// GET /:id/dependencies : compte les references vers l'employe (pour preview hard delete).
router.get('/:id/dependencies', authenticate, authorize(ROLES.ADMIN), employeeController.dependencies);
// DELETE /:id : soft delete par defaut. ?hard=true cascade les enfants + supprime l'employe.
router.delete('/:id', authenticate, authorize(ROLES.ADMIN), employeeController.remove);

export default router;

// Schedules
export const schedulesRouter = Router();
// Parser local pour la sauvegarde batch du planning hebdo. La limite globale
// (10kb, OWASP A04) est trop serree : une semaine complete pour tout l'effectif
// (50+ employes x 7 jours x ~100 octets par assignation) depasse 10 Ko et renvoie
// un 413. 256 Ko donne une marge confortable tout en restant inexploitable en DoS.
const bigJsonParser = expressJson({ limit: '256kb' });
schedulesRouter.get('/week', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), scheduleController.week);
schedulesRouter.post('/week', bigJsonParser, authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), scheduleController.bulkWeek);
schedulesRouter.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), scheduleController.list);
schedulesRouter.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), scheduleController.create);
schedulesRouter.put('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), scheduleController.update);
schedulesRouter.delete('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), scheduleController.remove);

// Shifts (catalogue lecture seule)
export const shiftsRouter = Router();
shiftsRouter.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), shiftController.list);

// Attendance
export const attendanceRouter = Router();
attendanceRouter.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), attendanceController.list);
attendanceRouter.get('/summary', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), attendanceController.monthlySummary);
attendanceRouter.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), attendanceController.upsert);
attendanceRouter.post('/bulk', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), attendanceController.bulkUpsert);
attendanceRouter.delete('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), attendanceController.remove);

// Leaves
export const leavesRouter = Router();
leavesRouter.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), leaveController.list);
leavesRouter.get('/balance', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), leaveController.balance);
leavesRouter.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), leaveController.create);
leavesRouter.post('/:id/approve', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), leaveController.approve);
leavesRouter.post('/:id/reject', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), leaveController.reject);
leavesRouter.delete('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), leaveController.remove);

// Payroll
export const payrollRouter = Router();
payrollRouter.get('/', authenticate, authorize(ROLES.ADMIN), payrollController.list);
payrollRouter.post('/generate', authenticate, authorize(ROLES.ADMIN), payrollController.generate);
payrollRouter.put('/:id', authenticate, authorize(ROLES.ADMIN), payrollController.update);
payrollRouter.post('/:id/pay', authenticate, authorize(ROLES.ADMIN), payrollController.markPaid);

// Weekly payroll (lundi = jour de paie pour les employes hebdo)
export const weeklyPayrollRouter = Router();
weeklyPayrollRouter.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), weeklyPayrollController.list);
weeklyPayrollRouter.post('/generate', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), weeklyPayrollController.generate);
weeklyPayrollRouter.put('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), weeklyPayrollController.update);
weeklyPayrollRouter.post('/:id/pay', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), weeklyPayrollController.markPaid);
weeklyPayrollRouter.post('/:id/unpay', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), weeklyPayrollController.unmarkPaid);
weeklyPayrollRouter.delete('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), weeklyPayrollController.remove);
