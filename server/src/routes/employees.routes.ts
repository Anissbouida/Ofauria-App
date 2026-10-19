import { Router, json as expressJson, type Request, type Response, type NextFunction } from 'express';
import { employeeController, scheduleController, attendanceController, leaveController, payrollController, shiftController, weeklyPayrollController, biweeklyPayrollController, salaryAdvanceController } from '../controllers/employee.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { authorizeModule } from '../middleware/module.middleware.js';
import { payrollConfigController } from '../controllers/payroll-config.controller.js';
import { hrContractController } from '../controllers/hr-contract.controller.js';
import multer from 'multer';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate } from '../middleware/validate.middleware.js';
import {
  createEmployeeSchema, updateEmployeeSchema,
  upsertAttendanceSchema, bulkAttendanceSchema,
  createLeaveSchema,
  generatePayrollSchema, updatePayrollSchema, markPaidSchema,
  generateWeeklyPayrollSchema, updateWeeklyPayrollSchema,
  generateBiweeklyPayrollSchema, updateBiweeklyPayrollSchema,
  createAdvanceSchema, updateAdvanceSchema,
  createScheduleSchema, updateScheduleSchema, bulkWeekScheduleSchema,
  setPayrollLinesSchema, payrollPeriodSchema, createRubriqueSchema, updateRubriqueSchema,
  employeePayrollItemSchema, updateEmployeePayrollItemSchema, payrollSettingsSchema, updateTaxScaleSchema,
  declarePayrollSchema, settlePayrollDeclarationSchema, holidaySchema, leaveAdjustmentSchema,
  createContractSchema, contractAvenantSchema, renewContractSchema, endContractSchema,
} from '../validators/employees.validator.js';
import { ROLES } from '@ofauria/shared';

// Droits : module « employees » (Personnel) via authorizeModule — view pour les
// lectures, create/edit pour les saisies. Les suppressions de saisies courantes
// (pointage, conge, planning, paie hebdo non payee) relevent de « edit » pour ne
// pas retirer ces gestes au gerant. Restent admin : creation/suppression
// d'employe et modification/suppression d'avance (impact caisse + compta).

const router = Router();

router.get('/', authenticate, authorizeModule('employees', 'view'), asyncHandler(employeeController.list));
// Alertes RH (fins de CDD et d'essai, pieces) — avant '/:id'.
router.get('/hr-alerts', authenticate, authorizeModule('employees', 'view'), asyncHandler(hrContractController.alerts));
router.get('/documents/:docId/file', authenticate, authorizeModule('employees', 'view'), asyncHandler(hrContractController.download));
router.delete('/documents/:docId', authenticate, authorizeModule('employees', 'edit'), asyncHandler(hrContractController.removeDocument));
router.get('/:id', authenticate, authorizeModule('employees', 'view'), asyncHandler(employeeController.getById));
router.post('/', authenticate, authorize(ROLES.ADMIN), validate(createEmployeeSchema), asyncHandler(employeeController.create));
router.put('/:id', authenticate, authorizeModule('employees', 'edit'), validate(updateEmployeeSchema), asyncHandler(employeeController.update));
router.get('/:id/salary-history', authenticate, authorizeModule('employees', 'view'), asyncHandler(employeeController.salaryHistory));
// Contrats et avenants (lot 4) : droit Personnel en edition.
router.get('/:employeeId/contracts', authenticate, authorizeModule('employees', 'view'), asyncHandler(hrContractController.list));
router.post('/:employeeId/contracts', authenticate, authorizeModule('employees', 'edit'), validate(createContractSchema), asyncHandler(hrContractController.create));
router.post('/:employeeId/contracts/avenant', authenticate, authorizeModule('employees', 'edit'), validate(contractAvenantSchema), asyncHandler(hrContractController.avenant));
router.post('/:employeeId/contracts/renew', authenticate, authorizeModule('employees', 'edit'), validate(renewContractSchema), asyncHandler(hrContractController.renew));
router.post('/:employeeId/contracts/renew-trial', authenticate, authorizeModule('employees', 'edit'), asyncHandler(hrContractController.renewTrial));
router.post('/:employeeId/contracts/end', authenticate, authorizeModule('employees', 'edit'), validate(endContractSchema), asyncHandler(hrContractController.end));
// Documents (stockes en base, 5 Mo max) : donnees personnelles, droit Personnel.
const documentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
router.get('/:employeeId/documents', authenticate, authorizeModule('employees', 'view'), asyncHandler(hrContractController.documents));
// Fichier trop lourd : erreur lisible (400) au lieu d'une erreur serveur.
const singleDocument = (req: Request, res: Response, next: NextFunction) =>
  documentUpload.single('file')(req, res, (err?: unknown) => {
    if (err) { res.status(400).json({ success: false, error: { message: err instanceof Error && /File too large/.test(err.message) ? 'Fichier trop lourd (5 Mo max)' : 'Fichier invalide' } }); return; }
    next();
  });
router.post('/:employeeId/documents', authenticate, authorizeModule('employees', 'edit'), singleDocument, asyncHandler(hrContractController.upload));
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
schedulesRouter.get('/week', authenticate, authorizeModule('employees', 'view'), asyncHandler(scheduleController.week));
schedulesRouter.post('/week', bigJsonParser, authenticate, authorizeModule('employees', 'edit'), validate(bulkWeekScheduleSchema), asyncHandler(scheduleController.bulkWeek));
schedulesRouter.get('/', authenticate, authorizeModule('employees', 'view'), asyncHandler(scheduleController.list));
schedulesRouter.post('/', authenticate, authorizeModule('employees', 'create'), validate(createScheduleSchema), asyncHandler(scheduleController.create));
schedulesRouter.put('/:id', authenticate, authorizeModule('employees', 'edit'), validate(updateScheduleSchema), asyncHandler(scheduleController.update));
schedulesRouter.delete('/:id', authenticate, authorizeModule('employees', 'edit'), asyncHandler(scheduleController.remove));

// Shifts (catalogue lecture seule)
export const shiftsRouter = Router();
shiftsRouter.get('/', authenticate, authorizeModule('employees', 'view'), asyncHandler(shiftController.list));

// Attendance
export const attendanceRouter = Router();
attendanceRouter.get('/', authenticate, authorizeModule('employees', 'view'), asyncHandler(attendanceController.list));
attendanceRouter.get('/overtime-summary', authenticate, authorizeModule('employees', 'view'), asyncHandler(attendanceController.overtimeSummary));
attendanceRouter.get('/summary', authenticate, authorizeModule('employees', 'view'), asyncHandler(attendanceController.monthlySummary));
attendanceRouter.post('/', authenticate, authorizeModule('employees', 'create'), validate(upsertAttendanceSchema), asyncHandler(attendanceController.upsert));
attendanceRouter.post('/bulk', authenticate, authorizeModule('employees', 'edit'), validate(bulkAttendanceSchema), asyncHandler(attendanceController.bulkUpsert));
attendanceRouter.delete('/:id', authenticate, authorizeModule('employees', 'edit'), asyncHandler(attendanceController.remove));

// Leaves
export const leavesRouter = Router();
leavesRouter.get('/', authenticate, authorizeModule('employees', 'view'), asyncHandler(leaveController.list));
leavesRouter.get('/balance', authenticate, authorizeModule('employees', 'view'), asyncHandler(leaveController.balance));
leavesRouter.get('/balances', authenticate, authorizeModule('employees', 'view'), asyncHandler(leaveController.balances));
leavesRouter.get('/preview', authenticate, authorizeModule('employees', 'view'), asyncHandler(leaveController.preview));
// Jours feries : lecture droit Personnel, modification admin (impact paie et soldes).
leavesRouter.get('/holidays', authenticate, authorizeModule('employees', 'view'), asyncHandler(leaveController.holidays));
leavesRouter.put('/holidays', authenticate, authorize(ROLES.ADMIN), validate(holidaySchema), asyncHandler(leaveController.upsertHoliday));
leavesRouter.delete('/holidays/:date', authenticate, authorize(ROLES.ADMIN), asyncHandler(leaveController.removeHoliday));
// Ajustements de solde (reprise d'un solde initial, regularisation) : admin.
leavesRouter.get('/adjustments/:employeeId', authenticate, authorizeModule('employees', 'view'), asyncHandler(leaveController.adjustments));
leavesRouter.post('/adjustments/:employeeId', authenticate, authorize(ROLES.ADMIN), validate(leaveAdjustmentSchema), asyncHandler(leaveController.createAdjustment));
leavesRouter.delete('/adjustments/entry/:id', authenticate, authorize(ROLES.ADMIN), asyncHandler(leaveController.removeAdjustment));
leavesRouter.post('/', authenticate, authorizeModule('employees', 'create'), validate(createLeaveSchema), asyncHandler(leaveController.create));
leavesRouter.post('/:id/approve', authenticate, authorizeModule('employees', 'edit'), asyncHandler(leaveController.approve));
leavesRouter.post('/:id/reject', authenticate, authorizeModule('employees', 'edit'), asyncHandler(leaveController.reject));
leavesRouter.delete('/:id', authenticate, authorizeModule('employees', 'edit'), asyncHandler(leaveController.remove));

// Payroll — gestion ouverte au gerant (ADMIN_MANAGER), comme la paie hebdo
// et les avances : c'est lui qui paie les salaires au quotidien.
export const payrollRouter = Router();

// Paie par quinzaine, montee sous /payroll/biweekly AVANT les routes /:id du
// mensuel (sinon '/biweekly' serait pris pour un id).
const biweeklyPayrollRouter = Router();
biweeklyPayrollRouter.get('/', authenticate, authorizeModule('employees', 'view'), asyncHandler(biweeklyPayrollController.list));
biweeklyPayrollRouter.post('/generate', authenticate, authorizeModule('employees', 'edit'), validate(generateBiweeklyPayrollSchema), asyncHandler(biweeklyPayrollController.generate));
biweeklyPayrollRouter.put('/:id', authenticate, authorizeModule('employees', 'edit'), validate(updateBiweeklyPayrollSchema), asyncHandler(biweeklyPayrollController.update));
biweeklyPayrollRouter.post('/:id/pay', authenticate, authorizeModule('employees', 'edit'), validate(markPaidSchema), asyncHandler(biweeklyPayrollController.markPaid));
biweeklyPayrollRouter.post('/:id/unpay', authenticate, authorizeModule('employees', 'edit'), asyncHandler(biweeklyPayrollController.unmarkPaid));
biweeklyPayrollRouter.delete('/:id', authenticate, authorizeModule('employees', 'edit'), asyncHandler(biweeklyPayrollController.remove));
payrollRouter.use('/biweekly', biweeklyPayrollRouter);

// Parametrage de la paie (mig 318) — routes nommees AVANT /:id.
// Lecture : droit Personnel ; bareme, reglages employeur, rubriques et
// cloture : admin (impact legal et comptable sur tous les bulletins).
payrollRouter.get('/settings', authenticate, authorizeModule('employees', 'view'), asyncHandler(payrollConfigController.getSettings));
payrollRouter.put('/settings', authenticate, authorize(ROLES.ADMIN), validate(payrollSettingsSchema), asyncHandler(payrollConfigController.updateSettings));
payrollRouter.put('/tax-scales/:id', authenticate, authorize(ROLES.ADMIN), validate(updateTaxScaleSchema), asyncHandler(payrollConfigController.updateTaxScale));
payrollRouter.get('/rubriques', authenticate, authorizeModule('employees', 'view'), asyncHandler(payrollConfigController.listRubriques));
payrollRouter.post('/rubriques', authenticate, authorize(ROLES.ADMIN), validate(createRubriqueSchema), asyncHandler(payrollConfigController.createRubrique));
payrollRouter.put('/rubriques/:id', authenticate, authorize(ROLES.ADMIN), validate(updateRubriqueSchema), asyncHandler(payrollConfigController.updateRubrique));
payrollRouter.get('/period', authenticate, authorizeModule('employees', 'view'), asyncHandler(payrollConfigController.period));
payrollRouter.post('/period/close', authenticate, authorize(ROLES.ADMIN), validate(payrollPeriodSchema), asyncHandler(payrollConfigController.closePeriod));
payrollRouter.post('/period/reopen', authenticate, authorize(ROLES.ADMIN), validate(payrollPeriodSchema), asyncHandler(payrollConfigController.reopenPeriod));
// Declarations CNSS / IR / CIMR : etats (droit Personnel), declarer et regler (admin).
payrollRouter.get('/declarations', authenticate, authorizeModule('employees', 'view'), asyncHandler(payrollConfigController.declarations));
payrollRouter.get('/declarations/annual-ir', authenticate, authorizeModule('employees', 'view'), asyncHandler(payrollConfigController.annualIr));
payrollRouter.post('/declarations/declare', authenticate, authorize(ROLES.ADMIN), validate(declarePayrollSchema), asyncHandler(payrollConfigController.declare));
payrollRouter.post('/declarations/settle', authenticate, authorize(ROLES.ADMIN), validate(settlePayrollDeclarationSchema), asyncHandler(payrollConfigController.settle));
// Elements fixes par employe (primes/indemnites/retenues recurrentes).
payrollRouter.get('/items/employee/:employeeId', authenticate, authorizeModule('employees', 'view'), asyncHandler(payrollConfigController.listItems));
payrollRouter.post('/items/employee/:employeeId', authenticate, authorizeModule('employees', 'edit'), validate(employeePayrollItemSchema), asyncHandler(payrollConfigController.createItem));
payrollRouter.put('/items/:itemId', authenticate, authorizeModule('employees', 'edit'), validate(updateEmployeePayrollItemSchema), asyncHandler(payrollConfigController.updateItem));
payrollRouter.delete('/items/:itemId', authenticate, authorizeModule('employees', 'edit'), asyncHandler(payrollConfigController.deleteItem));

payrollRouter.get('/', authenticate, authorizeModule('employees', 'view'), asyncHandler(payrollController.list));
payrollRouter.post('/generate', authenticate, authorizeModule('employees', 'edit'), validate(generatePayrollSchema), asyncHandler(payrollController.generate));
payrollRouter.get('/:id/lines', authenticate, authorizeModule('employees', 'view'), asyncHandler(payrollConfigController.lines));
payrollRouter.put('/:id/lines', authenticate, authorizeModule('employees', 'edit'), validate(setPayrollLinesSchema), asyncHandler(payrollConfigController.setLines));
payrollRouter.get('/:id/pdf', authenticate, authorizeModule('employees', 'view'), asyncHandler(payrollConfigController.pdf));
payrollRouter.put('/:id', authenticate, authorizeModule('employees', 'edit'), validate(updatePayrollSchema), asyncHandler(payrollController.update));
payrollRouter.post('/:id/pay', authenticate, authorizeModule('employees', 'edit'), validate(markPaidSchema), asyncHandler(payrollController.markPaid));
// Annulation d'un paiement (supprime la sortie de caisse + reverse les retenues d'avance)
payrollRouter.post('/:id/unpay', authenticate, authorizeModule('employees', 'edit'), asyncHandler(payrollController.unmarkPaid));

// Avances sur salaire (octroi via l'onglet Paie, retenue a la paie)
export const salaryAdvancesRouter = Router();
salaryAdvancesRouter.get('/', authenticate, authorizeModule('employees', 'view'), asyncHandler(salaryAdvanceController.list));
salaryAdvancesRouter.get('/outstanding', authenticate, authorizeModule('employees', 'view'), asyncHandler(salaryAdvanceController.outstanding));
salaryAdvancesRouter.post('/', authenticate, authorizeModule('employees', 'create'), validate(createAdvanceSchema), asyncHandler(salaryAdvanceController.create));
// Suppression reservee admin : reverse le decaissement + son ecriture comptable.
// Modification (plan de retenue, notes ; montant/mode/date si aucune retenue) : admin only
salaryAdvancesRouter.put('/:id', authenticate, authorize(ROLES.ADMIN), validate(updateAdvanceSchema), asyncHandler(salaryAdvanceController.update));
salaryAdvancesRouter.delete('/:id', authenticate, authorize(ROLES.ADMIN), asyncHandler(salaryAdvanceController.remove));

// Weekly payroll (lundi = jour de paie pour les employes hebdo)
export const weeklyPayrollRouter = Router();
weeklyPayrollRouter.get('/', authenticate, authorizeModule('employees', 'view'), asyncHandler(weeklyPayrollController.list));
weeklyPayrollRouter.post('/generate', authenticate, authorizeModule('employees', 'edit'), validate(generateWeeklyPayrollSchema), asyncHandler(weeklyPayrollController.generate));
weeklyPayrollRouter.put('/:id', authenticate, authorizeModule('employees', 'edit'), validate(updateWeeklyPayrollSchema), asyncHandler(weeklyPayrollController.update));
weeklyPayrollRouter.post('/:id/pay', authenticate, authorizeModule('employees', 'edit'), validate(markPaidSchema), asyncHandler(weeklyPayrollController.markPaid));
weeklyPayrollRouter.post('/:id/unpay', authenticate, authorizeModule('employees', 'edit'), asyncHandler(weeklyPayrollController.unmarkPaid));
weeklyPayrollRouter.delete('/:id', authenticate, authorizeModule('employees', 'edit'), asyncHandler(weeklyPayrollController.remove));

