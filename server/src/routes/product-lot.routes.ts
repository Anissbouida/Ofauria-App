import { Router } from 'express';
import { productLotController } from '../controllers/product-lot.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate, validateUuidParams } from '../middleware/validate.middleware.js';
import { emptyBody } from '../validators/common.validator.js';
import { orphanToLossesSchema, lotSendToLossesSchema, productLotMoveLocationSchema } from '../validators/stock-flow.validator.js';
import { productLotLocationRepository } from '../repositories/product-lot-location.repository.js';
import type { AuthRequest } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/expired-active', authenticate, asyncHandler(productLotController.expiredActive));

// F-045 — Reconciliation vitrine <-> lots : rapport (dry-run) pour le gerant,
// application reservee a l'admin (mutation du stock affiche, tracee).
router.get('/vitrine-reconciliation',
  authenticate, can('production.product_lots.view'),
  asyncHandler(productLotController.reconcileVitrine));
router.post('/vitrine-reconciliation/apply',
  authenticate, can('production.product_lots.apply'), validate(emptyBody),
  asyncHandler(productLotController.reconcileVitrine));
router.post('/send-orphan-to-losses',
  authenticate, can('production.product_lots.send_orphan_to_losses'), validate(orphanToLossesSchema),
  asyncHandler(productLotController.sendOrphanToLosses));
router.post('/:id/send-to-losses',
  authenticate, can('production.product_lots.send_to_losses'), validateUuidParams('id'), validate(lotSendToLossesSchema),
  asyncHandler(productLotController.sendToLosses));

// M6-02 (mig 605) : répartition d'un lot produit fini entre emplacements (Magasin, Frigo…)
// et déplacement tracé en mouvement entre emplacements.
router.get('/:id/locations', authenticate, validateUuidParams('id'), asyncHandler(async (req, res) => {
  const data = await productLotLocationRepository.lotLocations(req.params.id as string);
  if (!data) { res.status(404).json({ success: false, error: { message: 'Lot introuvable' } }); return; }
  res.json({ success: true, data: { ...data, moves: await productLotLocationRepository.lotMoves(req.params.id as string) } });
}));
router.post('/:id/move-location',
  authenticate, can('production.product_lots.move_location'), validateUuidParams('id'), validate(productLotMoveLocationSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as { fromLocationId?: string | null; toLocationId?: string | null; quantity: number; motif?: string };
    const data = await productLotLocationRepository.move({
      productLotId: req.params.id as string, fromLocationId: b.fromLocationId ?? null, toLocationId: b.toLocationId ?? null,
      quantity: b.quantity, motif: b.motif || 'transfert', userId: (req as AuthRequest).user?.userId ?? null,
    });
    res.json({ success: true, data });
  }));

export default router;
