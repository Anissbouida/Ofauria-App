import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requirePortalToken } from '../middleware/portal.middleware.js';
import { portalController as c } from '../controllers/portal.controller.js';

/**
 * Phase 10.3 — portail client (jeton Bearer). Monté AVANT le contrôle anti-CSRF
 * dans app.ts : pas de cookie. Lecture seule ; tout est limité au client du jeton.
 */
const router = Router();

router.get('/me', requirePortalToken, asyncHandler(c.me));
router.get('/orders', requirePortalToken, asyncHandler(c.orders));
router.get('/invoices', requirePortalToken, asyncHandler(c.invoices));
router.get('/invoices/:id/pdf', requirePortalToken, asyncHandler(c.invoicePdf));
router.get('/statement', requirePortalToken, asyncHandler(c.statement));

export default router;
