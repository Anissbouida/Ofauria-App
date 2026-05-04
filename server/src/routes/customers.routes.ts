import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { customerController } from '../controllers/customer.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { ROLE_GROUPS } from '@ofauria/shared';

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

router.get('/', authenticate, authorize(...ROLE_GROUPS.SALES), customerController.list);
router.get('/global-stats', authenticate, authorize(...ROLE_GROUPS.SALES), statsLimiter, customerController.globalStats);
router.get('/:id', authenticate, authorize(...ROLE_GROUPS.SALES), customerController.getById);
router.get('/:id/stats', authenticate, authorize(...ROLE_GROUPS.SALES), statsLimiter, customerController.stats);
router.post('/', authenticate, authorize(...ROLE_GROUPS.SALES), writeLimiter, customerController.create);
router.put('/:id', authenticate, authorize(...ROLE_GROUPS.SALES), writeLimiter, customerController.update);
router.delete('/:id', authenticate, authorize(...ROLE_GROUPS.ADMIN_MANAGER), writeLimiter, customerController.remove);

export default router;
