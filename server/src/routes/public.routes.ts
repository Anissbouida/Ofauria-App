import { Router } from 'express';
import { buildOpenApi, renderDocsHtml } from '../services/openapi.js';
import express from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireApiKey } from '../middleware/api-key.middleware.js';
import { validate, validateQuery } from '../middleware/validate.middleware.js';
import { publicApiController as c } from '../controllers/public.controller.js';
import { publicOrderSchema, publicEmptyQuerySchema } from '../validators/public-order.validator.js';

/**
 * Phase 10.2 — API publique (clé Bearer). Montée AVANT le contrôle anti-CSRF
 * dans app.ts : pas de cookie, pas d'Origin. Son propre parser JSON (le parser
 * global s'applique après le contrôle d'Origin).
 *
 * G0-01 : aucune route publique n'accepte une charge sans schéma.
 */
const router = Router();
const jsonParser = express.json({ limit: '256kb' });

// Vérifie la clé et renvoie sa portée.
// G6-08 : description OpenAPI générée et documentation publique (sans clé).
router.get('/openapi.json', validateQuery(publicEmptyQuerySchema), (_req, res) => { res.json(buildOpenApi()); });
router.get('/docs', validateQuery(publicEmptyQuerySchema), (_req, res) => { res.type('html').send(renderDocsHtml(buildOpenApi())); });
router.get('/v1/ping', requireApiKey(), validateQuery(publicEmptyQuerySchema), asyncHandler(c.ping));
// Catalogue des articles vendables.
router.get('/v1/products', requireApiKey('products:read'), validateQuery(publicEmptyQuerySchema), asyncHandler(c.listProducts));
// Création d'une commande par un site marchand.
router.post('/v1/orders', jsonParser, requireApiKey('orders:create'), validate(publicOrderSchema), asyncHandler(c.createOrder));

export default router;
