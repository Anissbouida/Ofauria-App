import { Router } from 'express';
import { unsoldDecisionController } from '../controllers/unsold-decision.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLES } from '@ofauria/shared';

const STORE_STAFF = [ROLES.ADMIN, ROLES.MANAGER, ROLES.CASHIER, ROLES.SALESWOMAN];

const router = Router();

// Suggestions auto pour l'inventaire en cours
router.get('/suggestions', authenticate, authorize(...STORE_STAFF), asyncHandler(unsoldDecisionController.suggestions));

// Statistiques tableau de bord
router.get('/stats', authenticate, asyncHandler(unsoldDecisionController.stats));

// Decisions d'une session specifique
router.get('/session/:sessionId', authenticate, asyncHandler(unsoldDecisionController.bySession));

// Historique
router.get('/', authenticate, asyncHandler(unsoldDecisionController.list));

// Enregistrer des decisions
router.post('/', authenticate, authorize(...STORE_STAFF), asyncHandler(unsoldDecisionController.save));

export default router;
