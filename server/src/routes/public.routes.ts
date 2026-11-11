import { Router } from 'express';
import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireApiKey } from '../middleware/api-key.middleware.js';
import { publicApiController as c } from '../controllers/public.controller.js';

/**
 * Phase 10.2 — API publique (clé Bearer). Montée AVANT le contrôle anti-CSRF
 * dans app.ts : pas de cookie, pas d'Origin. Son propre parser JSON (le parser
 * global s'applique après le contrôle d'Origin).
 */
const router = Router();
const jsonParser = express.json({ limit: '256kb' });

// Vérifie la clé et renvoie sa portée.
router.get('/v1/ping', requireApiKey(), asyncHandler(c.ping));
// Catalogue des articles vendables.
router.get('/v1/products', requireApiKey('products:read'), asyncHandler(c.listProducts));
// Création d'une commande par un site marchand.
router.post('/v1/orders', jsonParser, requireApiKey('orders:create'), asyncHandler(c.createOrder));

export default router;
