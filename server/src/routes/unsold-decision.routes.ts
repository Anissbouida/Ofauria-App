import { Router, json as expressJson } from 'express';
import { unsoldDecisionController } from '../controllers/unsold-decision.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ROLES } from '@ofauria/shared';

const STORE_STAFF = [ROLES.ADMIN, ROLES.MANAGER, ROLES.CASHIER, ROLES.SALESWOMAN];

// Parser local pour l'enregistrement batch des decisions invendus.
// La limite globale (10kb, OWASP A04) est trop serree pour une fin de journee
// avec 60+ produits et snapshot complet par ligne (nom, categorie, DLC, cost_price,
// ingredient recyclage, etc.). 256 Ko donne confortablement de la marge (~2 Ko
// par produit x 100 produits max realistes) tout en restant largement en dessous
// d'une taille exploitable pour un abus DoS.
const bigJsonParser = expressJson({ limit: '256kb' });

const router = Router();

// Suggestions auto pour l'inventaire en cours
router.get('/suggestions', authenticate, authorize(...STORE_STAFF), asyncHandler(unsoldDecisionController.suggestions));

// Statistiques tableau de bord
router.get('/stats', authenticate, asyncHandler(unsoldDecisionController.stats));

// Decisions d'une session specifique
router.get('/session/:sessionId', authenticate, asyncHandler(unsoldDecisionController.bySession));

// Historique
router.get('/', authenticate, asyncHandler(unsoldDecisionController.list));

// Enregistrer des decisions (payload batch -> parser avec limite elargie)
router.post('/', bigJsonParser, authenticate, authorize(...STORE_STAFF), asyncHandler(unsoldDecisionController.save));

export default router;
