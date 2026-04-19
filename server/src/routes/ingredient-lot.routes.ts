import { Router } from 'express';
import { ingredientLotController } from '../controllers/ingredient-lot.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

const router = Router();

router.get('/', authenticate, ingredientLotController.list);
router.get('/expiring', authenticate, ingredientLotController.expiring);
router.get('/expired', authenticate, ingredientLotController.expired);
router.get('/stats', authenticate, ingredientLotController.stats);
router.get('/quality-check/:id', authenticate, ingredientLotController.getQualityCheck);
router.get('/production/:planId/fefo-preview', authenticate, ingredientLotController.fefoPreview);
router.get('/production/:id', authenticate, ingredientLotController.productionLots);
router.get('/:id', authenticate, ingredientLotController.getById);
router.get('/:id/traceability', authenticate, ingredientLotController.traceability);
router.post('/:id/quarantine', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), ingredientLotController.quarantine);
router.post('/:id/waste', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), ingredientLotController.markAsWaste);
router.post('/quality-check/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), ingredientLotController.saveQualityCheck);

export default router;
