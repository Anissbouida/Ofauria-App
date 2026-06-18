import { Router } from 'express';
import { bankReconciliationController } from '../controllers/bank-reconciliation.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLES } from '@ofauria/shared';

// Rapprochement bancaire : reserve a l'admin.
const router = Router();

router.get('/statements', authenticate, authorize(ROLES.ADMIN), bankReconciliationController.listStatements);
router.post('/statements', authenticate, authorize(ROLES.ADMIN), bankReconciliationController.createStatement);
router.get('/statements/:id', authenticate, authorize(ROLES.ADMIN), bankReconciliationController.getReconciliation);
router.post('/statements/:id/auto-match', authenticate, authorize(ROLES.ADMIN), bankReconciliationController.autoMatch);
router.delete('/statements/:id', authenticate, authorize(ROLES.ADMIN), bankReconciliationController.deleteStatement);
router.post('/lines/:id/match', authenticate, authorize(ROLES.ADMIN), bankReconciliationController.matchLine);
router.post('/lines/:id/unmatch', authenticate, authorize(ROLES.ADMIN), bankReconciliationController.unmatchLine);

export default router;
