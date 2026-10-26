import { Router } from 'express';
import { approvalController } from '../controllers/approval.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS } from '@ofauria/shared';

/**
 * Approbations (lot 8). Préfixe volontairement absent de la garde par module :
 * la boîte est transverse, le service filtre lui-même ce que chacun peut
 * voir et trancher (approbateur désigné, rôle, délégué, administrateur).
 */
const router = Router();

router.get('/inbox', authenticate, asyncHandler(approvalController.inbox));
router.get('/count', authenticate, asyncHandler(approvalController.count));
router.get('/mine', authenticate, asyncHandler(approvalController.mine));
router.get('/history', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(approvalController.list));
router.get('/for/:docType/:docId', authenticate, asyncHandler(approvalController.forDocument));
router.get('/delegates', authenticate, asyncHandler(approvalController.delegates));
router.get('/delegations', authenticate, asyncHandler(approvalController.delegations));
router.post('/delegations', authenticate, asyncHandler(approvalController.addDelegation));
router.delete('/delegations/:id', authenticate, asyncHandler(approvalController.removeDelegation));
router.get('/:id', authenticate, asyncHandler(approvalController.byId));
router.post('/:id/approve', authenticate, asyncHandler(approvalController.approve));
router.post('/:id/reject', authenticate, asyncHandler(approvalController.reject));
router.post('/:id/cancel', authenticate, asyncHandler(approvalController.cancel));

export default router;
