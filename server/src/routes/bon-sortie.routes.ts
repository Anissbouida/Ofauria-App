import { Router } from 'express';
import { bonSortieController } from '../controllers/bon-sortie.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

// Generate a bon de sortie from plan needs
router.post('/generate', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(bonSortieController.generate));

// Get bon(s) for a plan
router.get('/plan/:planId', authenticate, asyncHandler(bonSortieController.getByPlan));

// Get single bon by id
router.get('/:id', authenticate, asyncHandler(bonSortieController.getById));

// Workflow actions
router.put('/:id/prelevement', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(bonSortieController.startPrelevement));
router.put('/ligne/:ligneId', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(bonSortieController.updateLigne));
router.put('/:id/verify', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(bonSortieController.verify));
router.put('/:id/close', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(bonSortieController.close));
router.put('/:id/cancel', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(bonSortieController.cancel));

// Ecart handling
router.put('/:id/ecart/:ligneId', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(bonSortieController.handleEcart));

// Regenerate bon for a plan
router.post('/plan/:planId/regenerate', authenticate, authorize(...ROLE_GROUPS.PRODUCTION), asyncHandler(bonSortieController.regenerate));

export default router;
