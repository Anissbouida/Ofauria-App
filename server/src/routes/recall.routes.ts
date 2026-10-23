import { Router } from 'express';
import { recallController } from '../controllers/recall.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

// Rappel de lot : audit de traçabilité descendante. Réservé à l'administrateur et
// au gérant, cohérent avec la garde de module `/traceability` (controle/production)
// montée dans routes/index.ts.
router.get(
  '/recall/ingredient-lot/:id',
  authenticate,
  authorize(...ROLE_GROUPS.ADMIN_MANAGER),
  recallController.recallFromIngredientLot
);

export default router;
