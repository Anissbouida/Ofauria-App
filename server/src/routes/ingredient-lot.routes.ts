import { Router } from 'express';
import { ingredientLotController } from '../controllers/ingredient-lot.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/', authenticate, ingredientLotController.list);
router.get('/expiring', authenticate, ingredientLotController.expiring);
router.get('/expired', authenticate, ingredientLotController.expired);
router.get('/stats', authenticate, ingredientLotController.stats);
router.get('/quality-check/:id', authenticate, ingredientLotController.getQualityCheck);
router.get('/production/:id', authenticate, ingredientLotController.productionLots);
router.get('/:id', authenticate, ingredientLotController.getById);
router.get('/:id/traceability', authenticate, ingredientLotController.traceability);
router.post('/:id/quarantine', authenticate, ingredientLotController.quarantine);
router.post('/:id/waste', authenticate, ingredientLotController.markAsWaste);
router.post('/quality-check/:id', authenticate, ingredientLotController.saveQualityCheck);

export default router;
