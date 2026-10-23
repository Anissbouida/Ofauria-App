import { Router } from 'express';
import { ingredientLotController } from '../controllers/ingredient-lot.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

router.get('/', authenticate, asyncHandler(ingredientLotController.list));
router.get('/expiring', authenticate, ingredientLotController.expiring);
router.get('/expired', authenticate, ingredientLotController.expired);
router.get('/expired-active', authenticate, ingredientLotController.expiredActive);
// Stock actuel au Pesage (sacs ouverts) — agrege par ingredient pour vue magasinier
router.get('/pesage-stock', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), asyncHandler(ingredientLotController.pesageStock));
router.get('/stats', authenticate, ingredientLotController.stats);
router.get('/quality-check/:id', authenticate, ingredientLotController.getQualityCheck);
router.get('/production/:planId/fefo-preview', authenticate, ingredientLotController.fefoPreview);
router.get('/production/:id', authenticate, ingredientLotController.productionLots);
router.get('/:id', authenticate, ingredientLotController.getById);
router.get('/:id/traceability', authenticate, ingredientLotController.traceability);
router.post('/:id/quarantine', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), ingredientLotController.quarantine);
router.post('/quality-check/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), ingredientLotController.saveQualityCheck);
// Mouvements de lot (module Stock) : point d'entree unique. Restreint au magasinier
// (et admin/gerant) : le chef ne gere pas les zones, il passe par le bon de sortie.
// Les routes specialisees ci-dessous restent en facade pour les clients non mis a jour.
router.post('/:id/movement', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), asyncHandler(ingredientLotController.movement));
router.post('/:id/open-to-pesage', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), asyncHandler(ingredientLotController.openToPesage));
router.post('/:id/return-to-economat', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), asyncHandler(ingredientLotController.returnToEconomat));
router.post('/:id/pesage-waste', authenticate, authorize(...ROLE_GROUPS.WAREHOUSE), asyncHandler(ingredientLotController.wasteFromPesage));
router.post('/:id/send-to-losses', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER, 'magasinier'), ingredientLotController.sendToLosses);

export default router;
