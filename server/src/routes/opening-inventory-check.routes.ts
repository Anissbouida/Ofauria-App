import { Router } from 'express';
import { openingInventoryCheckController } from '../controllers/opening-inventory-check.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';

const router = Router();

// Caissière ou manager: consulter la liste matinale et soumettre le recomptage
router.get(
  '/opening/pending',
  authenticate,
  can('pos.inventory_checks.opening_pending.view'),
  openingInventoryCheckController.getPending
);
router.post(
  '/opening',
  authenticate,
  can('pos.inventory_checks.opening'),
  openingInventoryCheckController.create
);

// Manager/Admin uniquement: valider ou rejeter un check en écart
router.get(
  '/opening/awaiting-validation',
  authenticate,
  can('pos.inventory_checks.opening_awaiting_validation.view'),
  openingInventoryCheckController.listAwaitingValidation
);
router.post(
  '/opening/:id/validate',
  authenticate,
  can('pos.inventory_checks.validate'),
  openingInventoryCheckController.validate
);

// Détail (lecture pour caisse + manager)
router.get(
  '/opening/:id',
  authenticate,
  can('pos.inventory_checks.opening.view'),
  openingInventoryCheckController.getById
);

export default router;
