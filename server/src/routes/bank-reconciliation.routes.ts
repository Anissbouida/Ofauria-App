import { Router } from 'express';
import { bankReconciliationController } from '../controllers/bank-reconciliation.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

// Rapprochement bancaire : reserve a l'admin.
const router = Router();

router.get('/statements', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), bankReconciliationController.listStatements);
router.post('/statements', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), bankReconciliationController.createStatement);
router.get('/statements/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), bankReconciliationController.getReconciliation);
router.post('/statements/:id/auto-match', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), bankReconciliationController.autoMatch);
router.delete('/statements/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), bankReconciliationController.deleteStatement);
router.post('/lines/:id/match', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), bankReconciliationController.matchLine);
router.post('/lines/:id/unmatch', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), bankReconciliationController.unmatchLine);

export default router;
