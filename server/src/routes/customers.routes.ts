import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { customerController } from '../controllers/customer.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';
import { asyncHandler } from '../middleware/asyncHandler.js';

// Rate limit strict pour endpoints de lecture agregee / stats
// (evite enumeration d'IDs clients et scraping de donnees).
const statsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Trop de requetes sur les stats clients' } },
});

// Rate limit sur creation / modification (anti-spam).
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Trop d\'operations d\'ecriture sur les clients' } },
});

const router = Router();

router.get('/', authenticate, authorize(...ROLE_GROUPS.SALES), asyncHandler(customerController.list));
router.get('/global-stats', authenticate, authorize(...ROLE_GROUPS.SALES), statsLimiter, asyncHandler(customerController.globalStats));
// Doublons probables (phase 4.3) — avant /:id pour ne pas être capturé comme id.
router.get('/check', authenticate, authorize(...ROLE_GROUPS.SALES), asyncHandler(customerController.check));
router.get('/:id/situation', authenticate, authorize(...ROLE_GROUPS.SALES), asyncHandler(customerController.situation));
router.get('/:id/statement', authenticate, authorize(...ROLE_GROUPS.SALES), asyncHandler(customerController.statement));
router.get('/:id', authenticate, authorize(...ROLE_GROUPS.SALES), asyncHandler(customerController.getById));
router.get('/:id/stats', authenticate, authorize(...ROLE_GROUPS.SALES), statsLimiter, asyncHandler(customerController.stats));
// Adresses multiples (phase 4.1)
router.get('/:id/addresses', authenticate, authorize(...ROLE_GROUPS.SALES), asyncHandler(customerController.listAddresses));
router.post('/:id/addresses', authenticate, authorize(...ROLE_GROUPS.SALES), writeLimiter, asyncHandler(customerController.createAddress));
router.put('/:id/addresses/:addressId', authenticate, authorize(...ROLE_GROUPS.SALES), writeLimiter, asyncHandler(customerController.updateAddress));
router.delete('/:id/addresses/:addressId', authenticate, authorize(...ROLE_GROUPS.SALES), writeLimiter, asyncHandler(customerController.removeAddress));
router.post('/', authenticate, authorize(...ROLE_GROUPS.SALES), writeLimiter, asyncHandler(customerController.create));
router.put('/:id', authenticate, authorize(...ROLE_GROUPS.SALES), writeLimiter, asyncHandler(customerController.update));
router.delete('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), writeLimiter, asyncHandler(customerController.remove));

export default router;
