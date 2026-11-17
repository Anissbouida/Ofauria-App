import { Router } from 'express';
import { productLotController } from '../controllers/product-lot.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.get('/expired-active', authenticate, asyncHandler(productLotController.expiredActive));

// F-045 — Reconciliation vitrine <-> lots : rapport (dry-run) pour le gerant,
// application reservee a l'admin (mutation du stock affiche, tracee).
router.get('/vitrine-reconciliation',
  authenticate, can('production.product_lots.view'),
  asyncHandler(productLotController.reconcileVitrine));
router.post('/vitrine-reconciliation/apply',
  authenticate, can('production.product_lots.apply'),
  asyncHandler(productLotController.reconcileVitrine));
router.post('/send-orphan-to-losses',
  authenticate, can('production.product_lots.send_orphan_to_losses'),
  asyncHandler(productLotController.sendOrphanToLosses));
router.post('/:id/send-to-losses',
  authenticate, can('production.product_lots.send_to_losses'),
  asyncHandler(productLotController.sendToLosses));

export default router;
