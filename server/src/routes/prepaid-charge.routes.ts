import { Router } from 'express';
import { prepaidChargeController } from '../controllers/prepaid-charge.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { createPrepaidChargeSchema, recognizePrepaidChargesSchema } from '../validators/accounting-setup.validator.js';

// Charges constatées d'avance (mig 380) : réservé admin/gérant (noyau comptable).
const router = Router();

router.get('/', authenticate, can('accounting.prepaid_charges.view'), prepaidChargeController.list);
router.post('/', authenticate, can('accounting.prepaid_charges.create'), validate(createPrepaidChargeSchema), prepaidChargeController.create);
router.post('/recognize', authenticate, can('accounting.prepaid_charges.recognize'), validate(recognizePrepaidChargesSchema), prepaidChargeController.recognize);
router.get('/:id', authenticate, can('accounting.prepaid_charges.view'), prepaidChargeController.getById);

export default router;
