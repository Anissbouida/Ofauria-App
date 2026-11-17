import { Router } from 'express';
import { prepaidChargeController } from '../controllers/prepaid-charge.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';

// Charges constatées d'avance (mig 380) : réservé admin/gérant (noyau comptable).
const router = Router();

router.get('/', authenticate, can('accounting.prepaid_charges.view'), prepaidChargeController.list);
router.post('/', authenticate, can('accounting.prepaid_charges.create'), prepaidChargeController.create);
router.post('/recognize', authenticate, can('accounting.prepaid_charges.recognize'), prepaidChargeController.recognize);
router.get('/:id', authenticate, can('accounting.prepaid_charges.view'), prepaidChargeController.getById);

export default router;
