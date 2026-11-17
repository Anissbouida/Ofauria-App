import { Router } from 'express';
import { paymentScheduleController } from '../controllers/payment-schedule.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';


/** /api/v1/payment-schedules — le calendrier des echeances. */
export const paymentSchedulesRouter = Router();
paymentSchedulesRouter.get('/', authenticate, can('accounting.payment_schedules.view'), paymentScheduleController.list);
paymentSchedulesRouter.get('/by-source/:kind/:id', authenticate, can('accounting.payment_schedules.view'), paymentScheduleController.bySource);
paymentSchedulesRouter.patch('/:id', authenticate, can('accounting.payment_schedules.edit'), paymentScheduleController.update);

/** /api/v1/debts — dettes echelonnees sans facture. */
export const debtsRouter = Router();
debtsRouter.get('/', authenticate, can('accounting.debts.view'), paymentScheduleController.listDebts);
debtsRouter.post('/', authenticate, can('accounting.debts.create'), paymentScheduleController.createDebt);
debtsRouter.patch('/:id', authenticate, can('accounting.debts.edit'), paymentScheduleController.updateDebt);
debtsRouter.delete('/:id', authenticate, can('accounting.debts.delete'), paymentScheduleController.removeDebt);

/** /api/v1/recurring-charges — modeles de charges fixes (loyer, electricite). */
export const recurringChargesRouter = Router();
recurringChargesRouter.get('/', authenticate, can('accounting.recurring_charges.view'), paymentScheduleController.listRecurring);
recurringChargesRouter.post('/', authenticate, can('accounting.recurring_charges.create'), paymentScheduleController.createRecurring);
recurringChargesRouter.patch('/:id', authenticate, can('accounting.recurring_charges.edit'), paymentScheduleController.updateRecurring);
recurringChargesRouter.delete('/:id', authenticate, can('accounting.recurring_charges.delete'), paymentScheduleController.removeRecurring);
