import { Router } from 'express';
import { cashRegisterController } from '../controllers/cash-register.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { openRegisterSchema, closeRegisterSchema, submitRegisterAmountSchema } from '../validators/cash-register.validator.js';

const router = Router();

router.get('/', authenticate, authorize(...ROLE_GROUPS.CASH), cashRegisterController.list);
router.get('/current', authenticate, authorize(...ROLE_GROUPS.CASH), cashRegisterController.currentSession);
router.get('/last-amount', authenticate, authorize(...ROLE_GROUPS.CASH), cashRegisterController.lastClosedAmount);
router.get('/closure-gaps', authenticate, authorize(...ROLE_GROUPS.ADMIN), cashRegisterController.closureGapsPreview);
router.post('/closure-gaps/post', authenticate, authorize(...ROLE_GROUPS.ADMIN), cashRegisterController.postClosureGaps);
router.get('/:id', authenticate, authorize(...ROLE_GROUPS.CASH), cashRegisterController.getById);
router.get('/:id/inventory', authenticate, authorize(...ROLE_GROUPS.CASH), cashRegisterController.getInventoryItems);
// G0-07 : montants de caisse validés par schéma.
router.post('/open', authenticate, authorize(...ROLE_GROUPS.CASH), validate(openRegisterSchema), cashRegisterController.open);
router.post('/close', authenticate, authorize(...ROLE_GROUPS.CASH), validate(closeRegisterSchema), cashRegisterController.close);
router.post('/:id/submit', authenticate, authorize(...ROLE_GROUPS.CASH), validateUuidParams('id'), validate(submitRegisterAmountSchema), cashRegisterController.submitAmount);
router.post('/:id/print-z', authenticate, authorize(...ROLE_GROUPS.CASH), cashRegisterController.printZ);

export default router;
