import { Router } from 'express';
import { ingredientLotController } from '../controllers/ingredient-lot.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { can } from '../middleware/permission.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

router.get('/', authenticate, asyncHandler(ingredientLotController.list));
router.get('/expiring', authenticate, ingredientLotController.expiring);
router.get('/expired', authenticate, ingredientLotController.expired);
router.get('/expired-active', authenticate, ingredientLotController.expiredActive);
// Stock actuel au Pesage (sacs ouverts) — agrege par ingredient pour vue magasinier
router.get('/pesage-stock', authenticate, can('stock.ingredient_lots.view'), asyncHandler(ingredientLotController.pesageStock));
router.get('/stats', authenticate, ingredientLotController.stats);
router.get('/quality-check/:id', authenticate, ingredientLotController.getQualityCheck);
router.get('/production/:planId/fefo-preview', authenticate, ingredientLotController.fefoPreview);
router.get('/production/:id', authenticate, ingredientLotController.productionLots);
router.get('/:id', authenticate, ingredientLotController.getById);
router.get('/:id/traceability', authenticate, ingredientLotController.traceability);
router.post('/:id/quarantine', authenticate, can('stock.ingredient_lots.quarantine'), ingredientLotController.quarantine);
// Déplacement physique vers un emplacement (épic labo L1, mig 424/425).
router.post('/:id/move-location', authenticate, can('stock.ingredient_lots.move_location'), asyncHandler(ingredientLotController.moveLocation));
router.post('/quality-check/:id', authenticate, can('stock.ingredient_lots.quality_check'), ingredientLotController.saveQualityCheck);
// Mouvements de lot (module Stock) : point d'entree unique. Restreint au magasinier
// (et admin/gerant) : le chef ne gere pas les zones, il passe par le bon de sortie.
// Les routes specialisees ci-dessous restent en facade pour les clients non mis a jour.
router.post('/:id/movement', authenticate, can('stock.ingredient_lots.movement'), asyncHandler(ingredientLotController.movement));
router.post('/:id/open-to-pesage', authenticate, can('stock.ingredient_lots.open_to_pesage'), asyncHandler(ingredientLotController.openToPesage));
router.post('/:id/return-to-economat', authenticate, can('stock.ingredient_lots.return_to_economat'), asyncHandler(ingredientLotController.returnToEconomat));
router.post('/:id/pesage-waste', authenticate, can('stock.ingredient_lots.pesage_waste'), asyncHandler(ingredientLotController.wasteFromPesage));
router.post('/:id/send-to-losses', authenticate, can('stock.ingredient_lots.send_to_losses'), ingredientLotController.sendToLosses);

export default router;
