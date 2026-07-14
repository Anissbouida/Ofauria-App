import { Router, json as expressJson } from 'express';
import { employeeController, scheduleController, attendanceController, leaveController, payrollController, shiftController, weeklyPayrollController, salaryAdvanceController } from '../controllers/employee.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate } from '../middleware/validate.middleware.js';
import {
  createEmployeeSchema, updateEmployeeSchema,
  upsertAttendanceSchema, bulkAttendanceSchema,
  createLeaveSchema,
  generatePayrollSchema, updatePayrollSchema, markPaidSchema,
  generateWeeklyPayrollSchema, updateWeeklyPayrollSchema,
  createAdvanceSchema, updateAdvanceSchema,
  createScheduleSchema, updateScheduleSchema, bulkWeekScheduleSchema,
} from '../validators/employees.validator.js';
import { ROLES, ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

router.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(employeeController.list));
router.get('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(employeeController.getById));
router.post('/', authenticate, authorize(ROLES.ADMIN), validate(createEmployeeSchema), asyncHandler(employeeController.create));
router.put('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(updateEmployeeSchema), asyncHandler(employeeController.update));
// GET /:id/dependencies : compte les references vers l'employe (pour preview hard delete).
router.get('/:id/dependencies', authenticate, authorize(ROLES.ADMIN), asyncHandler(employeeController.dependencies));
// DELETE /:id : soft delete par defaut. ?hard=true cascade les enfants + supprime l'employe.
router.delete('/:id', authenticate, authorize(ROLES.ADMIN), asyncHandler(employeeController.remove));

export default router;

// Schedules
export const schedulesRouter = Router();
// Parser local pour la sauvegarde batch du planning hebdo. La limite globale
// (10kb, OWASP A04) est trop serree : une semaine complete pour tout l'effectif
// (50+ employes x 7 jours x ~100 octets par assignation) depasse 10 Ko et renvoie
// un 413. 256 Ko donne une marge confortable tout en restant inexploitable en DoS.
const bigJsonParser = expressJson({ limit: '256kb' });
schedulesRouter.get('/week', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(scheduleController.week));
schedulesRouter.post('/week', bigJsonParser, authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(bulkWeekScheduleSchema), asyncHandler(scheduleController.bulkWeek));
schedulesRouter.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(scheduleController.list));
schedulesRouter.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(createScheduleSchema), asyncHandler(scheduleController.create));
schedulesRouter.put('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(updateScheduleSchema), asyncHandler(scheduleController.update));
schedulesRouter.delete('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(scheduleController.remove));

// Shifts (catalogue lecture seule)
export const shiftsRouter = Router();
shiftsRouter.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(shiftController.list));

// Attendance
export const attendanceRouter = Router();
attendanceRouter.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(attendanceController.list));
attendanceRouter.get('/summary', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(attendanceController.monthlySummary));
attendanceRouter.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(upsertAttendanceSchema), asyncHandler(attendanceController.upsert));
attendanceRouter.post('/bulk', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(bulkAttendanceSchema), asyncHandler(attendanceController.bulkUpsert));
attendanceRouter.delete('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(attendanceController.remove));

// Leaves
export const leavesRouter = Router();
leavesRouter.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(leaveController.list));
leavesRouter.get('/balance', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(leaveController.balance));
leavesRouter.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(createLeaveSchema), asyncHandler(leaveController.create));
leavesRouter.post('/:id/approve', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(leaveController.approve));
leavesRouter.post('/:id/reject', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(leaveController.reject));
leavesRouter.delete('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(leaveController.remove));

// Payroll — gestion ouverte au gerant (ADMIN_MANAGER), comme la paie hebdo
// et les avances : c'est lui qui paie les salaires au quotidien.
export const payrollRouter = Router();
payrollRouter.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(payrollController.list));
payrollRouter.post('/generate', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(generatePayrollSchema), asyncHandler(payrollController.generate));
payrollRouter.put('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(updatePayrollSchema), asyncHandler(payrollController.update));
payrollRouter.post('/:id/pay', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(markPaidSchema), asyncHandler(payrollController.markPaid));
// Annulation d'un paiement (supprime la sortie de caisse + reverse les retenues d'avance)
payrollRouter.post('/:id/unpay', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(payrollController.unmarkPaid));

// Avances sur salaire (octroi via l'onglet Paie, retenue a la paie)
export const salaryAdvancesRouter = Router();
salaryAdvancesRouter.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(salaryAdvanceController.list));
salaryAdvancesRouter.get('/outstanding', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(salaryAdvanceController.outstanding));
salaryAdvancesRouter.post('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(createAdvanceSchema), asyncHandler(salaryAdvanceController.create));
// Suppression reservee admin : reverse le decaissement + son ecriture comptable.
// Modification (plan de retenue, notes ; montant/mode/date si aucune retenue) : admin only
salaryAdvancesRouter.put('/:id', authenticate, authorize(ROLES.ADMIN), validate(updateAdvanceSchema), asyncHandler(salaryAdvanceController.update));
salaryAdvancesRouter.delete('/:id', authenticate, authorize(ROLES.ADMIN), asyncHandler(salaryAdvanceController.remove));

// Weekly payroll (lundi = jour de paie pour les employes hebdo)
export const weeklyPayrollRouter = Router();
weeklyPayrollRouter.get('/', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(weeklyPayrollController.list));
weeklyPayrollRouter.post('/generate', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(generateWeeklyPayrollSchema), asyncHandler(weeklyPayrollController.generate));
weeklyPayrollRouter.put('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(updateWeeklyPayrollSchema), asyncHandler(weeklyPayrollController.update));
weeklyPayrollRouter.post('/:id/pay', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), validate(markPaidSchema), asyncHandler(weeklyPayrollController.markPaid));
weeklyPayrollRouter.post('/:id/unpay', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(weeklyPayrollController.unmarkPaid));
weeklyPayrollRouter.delete('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(weeklyPayrollController.remove));
