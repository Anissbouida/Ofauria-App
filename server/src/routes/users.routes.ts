import { Router } from 'express';
import { userController } from '../controllers/user.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { roleController } from '../controllers/role.controller.js';
import { governanceController } from '../controllers/governance.controller.js';
import { accessReviewController } from '../controllers/access-review.controller.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Roles editables et mode de controle des droits (mig 330) : declares avant /:id.
router.get('/roles', authenticate, can('users.view'), asyncHandler(roleController.list));
router.post('/roles', authenticate, can('users.roles'), asyncHandler(roleController.create));
router.get('/roles/:code/permissions', authenticate, can('users.view'), asyncHandler(roleController.permissions));
router.put('/roles/:code/permissions', authenticate, can('users.permissions'), asyncHandler(roleController.setPermissions));
router.put('/roles/:code', authenticate, can('users.roles'), asyncHandler(roleController.update));
router.delete('/roles/:code', authenticate, can('users.delete'), asyncHandler(roleController.remove));
router.get('/security', authenticate, can('users.view'), asyncHandler(roleController.security));
router.put('/security', authenticate, can('users.edit'), asyncHandler(roleController.setSecurityMode));

// Gouvernance (mig 336) : separation des taches (SoD), plafonds d'approbation,
// delegations temporaires. Litteraux specifiques declares avant /sod/:code.
router.get('/sod/violations', authenticate, can('users.view'), asyncHandler(governanceController.sodViolations));
router.get('/sod/mode', authenticate, can('users.view'), asyncHandler(governanceController.sodMode));
router.put('/sod/mode', authenticate, can('users.edit'), asyncHandler(governanceController.setSodMode));
router.get('/sod', authenticate, can('users.view'), asyncHandler(governanceController.sodList));
router.post('/sod', authenticate, can('users.sod'), asyncHandler(governanceController.sodCreate));
router.put('/sod/:code', authenticate, can('users.sod'), asyncHandler(governanceController.sodUpdate));
router.delete('/sod/:code', authenticate, can('users.delete'), asyncHandler(governanceController.sodRemove));

router.get('/approval-limits', authenticate, can('users.view'), asyncHandler(governanceController.limitsList));
router.post('/approval-limits', authenticate, can('users.approval_limits'), asyncHandler(governanceController.limitsSet));
router.delete('/approval-limits/:id', authenticate, can('users.delete'), asyncHandler(governanceController.limitsRemove));

router.get('/delegations', authenticate, can('users.view'), asyncHandler(governanceController.delegationsList));
router.post('/delegations', authenticate, can('users.delegations'), asyncHandler(governanceController.delegationsCreate));
router.delete('/delegations/:id', authenticate, can('users.delete'), asyncHandler(governanceController.delegationsRemove));

router.get('/', authenticate, can('users.view'), userController.list);
router.post('/', authenticate, can('users.create'), userController.create);
router.put('/:id', authenticate, can('users.edit'), userController.update);
router.delete('/:id', authenticate, can('users.delete'), userController.remove);

// Permissions
router.get('/me/permissions', authenticate, userController.myPermissions);
router.get('/:id/permissions', authenticate, can('users.view'), userController.getPermissions);
router.put('/:id/permissions', authenticate, can('users.permissions'), userController.setPermissions);

// Lien espace employe : fiches salariees disponibles pour le selecteur.
router.get('/employees-link', authenticate, can('users.view'), asyncHandler(userController.employeesForLink));

// Revue des acces (Phase 3, outils admin, lecture seule).
router.get('/access-overview', authenticate, can('users.view'), asyncHandler(accessReviewController.overview));
router.get('/:id/access-review', authenticate, can('users.view'), asyncHandler(accessReviewController.review));
router.get('/:id/access-history', authenticate, can('users.view'), asyncHandler(accessReviewController.history));

export default router;
