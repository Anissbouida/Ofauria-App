import { Router } from 'express';
import { refTableController, refEntryController, refDashboardController } from '../controllers/referentiel.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLES, ROLE_GROUPS } from '@ofauria/shared';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Dashboard stats
router.get('/dashboard', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(refDashboardController.stats));

// List all registered reference tables
router.get('/tables', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(refTableController.list));

// CRUD on entries of a specific table
router.get('/:tableName', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(refEntryController.list));
router.post('/:tableName', authenticate, authorize(ROLES.ADMIN), asyncHandler(refEntryController.create));
router.put('/:tableName/reorder', authenticate, authorize(ROLES.ADMIN), asyncHandler(refEntryController.reorder));
router.get('/:tableName/audit', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), asyncHandler(refEntryController.audit));
router.put('/:tableName/:id', authenticate, authorize(ROLES.ADMIN), asyncHandler(refEntryController.update));
router.put('/:tableName/:id/reactivate', authenticate, authorize(ROLES.ADMIN), asyncHandler(refEntryController.reactivate));
router.delete('/:tableName/:id', authenticate, authorize(ROLES.ADMIN), asyncHandler(refEntryController.remove));

export default router;
