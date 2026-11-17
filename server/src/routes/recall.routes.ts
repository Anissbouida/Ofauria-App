import { Router } from 'express';
import { recallController } from '../controllers/recall.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

// Rappel de lot : audit de traçabilité descendante. Réservé à l'administrateur et
// au gérant, cohérent avec la garde de module `/traceability` (controle/production)
// montée dans routes/index.ts.
router.get(
  '/recall/ingredient-lot/:id',
  authenticate,
  can('controle.traceability.view'),
  asyncHandler(recallController.recallFromIngredientLot)
);

export default router;
