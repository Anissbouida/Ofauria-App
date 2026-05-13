import { Router } from 'express';
import { openingInventoryCheckController } from '../controllers/opening-inventory-check.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

// Caissière ou manager: consulter la liste matinale et soumettre le recomptage
router.get(
  '/opening/pending',
  authenticate,
  authorize(...ROLE_GROUPS.CASH),
  openingInventoryCheckController.getPending
);
router.post(
  '/opening',
  authenticate,
  authorize(...ROLE_GROUPS.CASH),
  openingInventoryCheckController.create
);

// Manager/Admin uniquement: valider ou rejeter un check en écart
router.get(
  '/opening/awaiting-validation',
  authenticate,
  authorize(...ROLE_GROUPS.ADMIN_MANAGER),
  openingInventoryCheckController.listAwaitingValidation
);
router.post(
  '/opening/:id/validate',
  authenticate,
  authorize(...ROLE_GROUPS.ADMIN_MANAGER),
  openingInventoryCheckController.validate
);

// Détail (lecture pour caisse + manager)
router.get(
  '/opening/:id',
  authenticate,
  authorize(...ROLE_GROUPS.CASH),
  openingInventoryCheckController.getById
);

export default router;
