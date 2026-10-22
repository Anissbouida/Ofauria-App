import { Router } from 'express';
import { userController } from '../controllers/user.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { roleController } from '../controllers/role.controller.js';
import { governanceController } from '../controllers/governance.controller.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Roles editables et mode de controle des droits (mig 330) : declares avant /:id.
router.get('/roles', authenticate, authorize('admin'), asyncHandler(roleController.list));
router.post('/roles', authenticate, authorize('admin'), asyncHandler(roleController.create));
router.get('/roles/:code/permissions', authenticate, authorize('admin'), asyncHandler(roleController.permissions));
router.put('/roles/:code/permissions', authenticate, authorize('admin'), asyncHandler(roleController.setPermissions));
router.put('/roles/:code', authenticate, authorize('admin'), asyncHandler(roleController.update));
router.delete('/roles/:code', authenticate, authorize('admin'), asyncHandler(roleController.remove));
router.get('/security', authenticate, authorize('admin'), asyncHandler(roleController.security));
router.put('/security', authenticate, authorize('admin'), asyncHandler(roleController.setSecurityMode));

// Gouvernance (mig 336) : separation des taches (SoD), plafonds d'approbation,
// delegations temporaires. Litteraux specifiques declares avant /sod/:code.
router.get('/sod/violations', authenticate, authorize('admin'), asyncHandler(governanceController.sodViolations));
router.get('/sod/mode', authenticate, authorize('admin'), asyncHandler(governanceController.sodMode));
router.put('/sod/mode', authenticate, authorize('admin'), asyncHandler(governanceController.setSodMode));
router.get('/sod', authenticate, authorize('admin'), asyncHandler(governanceController.sodList));
router.post('/sod', authenticate, authorize('admin'), asyncHandler(governanceController.sodCreate));
router.put('/sod/:code', authenticate, authorize('admin'), asyncHandler(governanceController.sodUpdate));
router.delete('/sod/:code', authenticate, authorize('admin'), asyncHandler(governanceController.sodRemove));

router.get('/approval-limits', authenticate, authorize('admin'), asyncHandler(governanceController.limitsList));
router.post('/approval-limits', authenticate, authorize('admin'), asyncHandler(governanceController.limitsSet));
router.delete('/approval-limits/:id', authenticate, authorize('admin'), asyncHandler(governanceController.limitsRemove));

router.get('/delegations', authenticate, authorize('admin'), asyncHandler(governanceController.delegationsList));
router.post('/delegations', authenticate, authorize('admin'), asyncHandler(governanceController.delegationsCreate));
router.delete('/delegations/:id', authenticate, authorize('admin'), asyncHandler(governanceController.delegationsRemove));

router.get('/', authenticate, authorize('admin'), userController.list);
router.post('/', authenticate, authorize('admin'), userController.create);
router.put('/:id', authenticate, authorize('admin'), userController.update);
router.delete('/:id', authenticate, authorize('admin'), userController.remove);

// Permissions
router.get('/me/permissions', authenticate, userController.myPermissions);
router.get('/:id/permissions', authenticate, authorize('admin'), userController.getPermissions);
router.put('/:id/permissions', authenticate, authorize('admin'), userController.setPermissions);

export default router;
