import { Router } from 'express';
import { refTableController, refEntryController, refDashboardController, refScopeController } from '../controllers/referentiel.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { authorizeSettings } from '../middleware/settings-access.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { activeUnits } from '../services/unit-referential.js';
import { validate } from '../middleware/validate.middleware.js';
import { refEntrySchema, refReactivateSchema, refReorderSchema } from '../validators/referentiel.validator.js';

const router = Router();

// Dashboard stats
router.get('/dashboard', authenticate, authorizeSettings('referentiel'), asyncHandler(refDashboardController.stats));

// List all registered reference tables
router.get('/tables', authenticate, authorizeSettings('referentiel'), asyncHandler(refTableController.list));

// Unités de mesure actives (mig 515) : lues par la fiche matière, la nomenclature et la
// production, donc ouvertes à tout utilisateur connecté (liste non sensible).
router.get('/units/active', authenticate, asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await activeUnits() });
}));

// Portée sectorielle des référentiels (mig 698) : contexte, aperçu d'un choix de secteur,
// resynchronisation. Déclarées avant « /:tableName ».
router.get('/scope', authenticate, authorizeSettings('referentiel'), asyncHandler(refScopeController.context));
router.get('/scope/preview', authenticate, authorizeSettings('referentiel'), asyncHandler(refScopeController.preview));
router.post('/scope/sync', authenticate, authorizeSettings('referentiel', 'edit'), validate(refReactivateSchema), asyncHandler(refScopeController.sync));

// CRUD on entries of a specific table
// Lecture ouverte au groupe WAREHOUSE (inclut le magasinier) : les référentiels sont des
// listes de valeurs non sensibles, et le magasinier a besoin de lire p.ex. les types de
// contenant au moment du transfert Économat → Pesage. Les mutations relevent du droit
// « Parametres » (section Referentiel).
router.get('/:tableName', authenticate, can('settings.params.view'), asyncHandler(refEntryController.list));
router.post('/:tableName', authenticate, authorizeSettings('referentiel', 'create'), validate(refEntrySchema), asyncHandler(refEntryController.create));
router.put('/:tableName/reorder', authenticate, authorizeSettings('referentiel', 'edit'), validate(refReorderSchema), asyncHandler(refEntryController.reorder));
router.get('/:tableName/audit', authenticate, authorizeSettings('referentiel'), asyncHandler(refEntryController.audit));
router.put('/:tableName/:id', authenticate, authorizeSettings('referentiel', 'edit'), validate(refEntrySchema), asyncHandler(refEntryController.update));
router.put('/:tableName/:id/reactivate', authenticate, authorizeSettings('referentiel', 'edit'), validate(refReactivateSchema), asyncHandler(refEntryController.reactivate));
router.put('/:tableName/:id/follow-sector', authenticate, authorizeSettings('referentiel', 'edit'), validate(refReactivateSchema), asyncHandler(refScopeController.followSector));
router.put('/:tableName/:id/restore-label', authenticate, authorizeSettings('referentiel', 'edit'), validate(refReactivateSchema), asyncHandler(refScopeController.restoreLabel));
router.delete('/:tableName/:id', authenticate, authorizeSettings('referentiel', 'delete'), asyncHandler(refEntryController.remove));

export default router;
