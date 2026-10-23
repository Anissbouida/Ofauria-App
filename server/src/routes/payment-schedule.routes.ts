import { Router } from 'express';
import { paymentScheduleController } from '../controllers/payment-schedule.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

// Echeancier des dettes & charges fixes : meme perimetre d'acces que le reste
// du suivi financier (admin / gerant).
const guard = [authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER)] as const;

/** /api/v1/payment-schedules — le calendrier des echeances. */
export const paymentSchedulesRouter = Router();
paymentSchedulesRouter.get('/', ...guard, paymentScheduleController.list);
paymentSchedulesRouter.get('/by-source/:kind/:id', ...guard, paymentScheduleController.bySource);
paymentSchedulesRouter.patch('/:id', ...guard, paymentScheduleController.update);

/** /api/v1/debts — dettes echelonnees sans facture. */
export const debtsRouter = Router();
debtsRouter.get('/', ...guard, paymentScheduleController.listDebts);
debtsRouter.post('/', ...guard, paymentScheduleController.createDebt);
debtsRouter.patch('/:id', ...guard, paymentScheduleController.updateDebt);
debtsRouter.delete('/:id', ...guard, paymentScheduleController.removeDebt);

/** /api/v1/recurring-charges — modeles de charges fixes (loyer, electricite). */
export const recurringChargesRouter = Router();
recurringChargesRouter.get('/', ...guard, paymentScheduleController.listRecurring);
recurringChargesRouter.post('/', ...guard, paymentScheduleController.createRecurring);
recurringChargesRouter.patch('/:id', ...guard, paymentScheduleController.updateRecurring);
recurringChargesRouter.delete('/:id', ...guard, paymentScheduleController.removeRecurring);
