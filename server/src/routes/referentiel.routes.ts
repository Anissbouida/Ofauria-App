import { Router } from 'express';
import { refTableController, refEntryController, refDashboardController } from '../controllers/referentiel.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { authorizeSettings } from '../middleware/settings-access.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Dashboard stats
router.get('/dashboard', authenticate, authorizeSettings('referentiel'), asyncHandler(refDashboardController.stats));

// List all registered reference tables
router.get('/tables', authenticate, authorizeSettings('referentiel'), asyncHandler(refTableController.list));

// CRUD on entries of a specific table
// Lecture ouverte au groupe WAREHOUSE (inclut le magasinier) : les référentiels sont des
// listes de valeurs non sensibles, et le magasinier a besoin de lire p.ex. les types de
// contenant au moment du transfert Économat → Pesage. Les mutations relevent du droit
// « Parametres » (section Referentiel).
router.get('/:tableName', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), asyncHandler(refEntryController.list));
router.post('/:tableName', authenticate, authorizeSettings('referentiel', 'create'), asyncHandler(refEntryController.create));
router.put('/:tableName/reorder', authenticate, authorizeSettings('referentiel', 'edit'), asyncHandler(refEntryController.reorder));
router.get('/:tableName/audit', authenticate, authorizeSettings('referentiel'), asyncHandler(refEntryController.audit));
router.put('/:tableName/:id', authenticate, authorizeSettings('referentiel', 'edit'), asyncHandler(refEntryController.update));
router.put('/:tableName/:id/reactivate', authenticate, authorizeSettings('referentiel', 'edit'), asyncHandler(refEntryController.reactivate));
router.delete('/:tableName/:id', authenticate, authorizeSettings('referentiel', 'delete'), asyncHandler(refEntryController.remove));

export default router;
