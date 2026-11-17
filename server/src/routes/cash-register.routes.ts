import { Router } from 'express';
import { cashRegisterController } from '../controllers/cash-register.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { openRegisterSchema, closeRegisterSchema, submitRegisterAmountSchema } from '../validators/cash-register.validator.js';

const router = Router();

router.get('/', authenticate, can('pos.cash_register.view'), cashRegisterController.list);
router.get('/current', authenticate, can('pos.cash_register.current.view'), cashRegisterController.currentSession);
router.get('/last-amount', authenticate, can('pos.cash_register.last_amount.view'), cashRegisterController.lastClosedAmount);
router.get('/closure-gaps', authenticate, can('pos.cash_register.closure_gaps.view'), cashRegisterController.closureGapsPreview);
router.post('/closure-gaps/post', authenticate, can('pos.cash_register.post'), cashRegisterController.postClosureGaps);
router.get('/:id', authenticate, can('pos.cash_register.view'), cashRegisterController.getById);
router.get('/:id/inventory', authenticate, can('pos.cash_register.inventory.view'), cashRegisterController.getInventoryItems);
// G0-07 : montants de caisse validés par schéma.
router.post('/open', authenticate, can('pos.cash_register.open'), validate(openRegisterSchema), cashRegisterController.open);
router.post('/close', authenticate, can('pos.cash_register.close'), validate(closeRegisterSchema), cashRegisterController.close);
router.post('/:id/submit', authenticate, can('pos.cash_register.submit'), validateUuidParams('id'), validate(submitRegisterAmountSchema), cashRegisterController.submitAmount);
router.post('/:id/print-z', authenticate, can('pos.cash_register.print_z'), cashRegisterController.printZ);

export default router;
