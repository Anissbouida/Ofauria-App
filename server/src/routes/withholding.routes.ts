import { Router } from 'express';
import { withholdingController } from '../controllers/withholding.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';

// Retenues a la source : admin + gerant (comme le reste de la comptabilite).
const router = Router();

router.get('/types', authenticate, can('accounting.withholding.view'), withholdingController.listTypes);
router.patch('/types/:id', authenticate, can('accounting.withholding.types'), withholdingController.updateType);
router.get('/to-remit', authenticate, can('accounting.withholding.view'), withholdingController.toRemit);
router.post('/reversement', authenticate, can('accounting.withholding.reversement'), withholdingController.reversement);

export default router;
