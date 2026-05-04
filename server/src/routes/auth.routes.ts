import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authController } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { loginSchema, registerSchema, pinLoginSchema } from '../validators/auth.validator.js';

// OWASP A07 : rate limiters par IP.
// DEV : les limites IP sont desactivees en dev/test pour eviter de bloquer
// l'equipe (plusieurs utilisateurs derriere la meme IP WiFi). La defense
// principale reste le lockout par compte (A04-2, 5 echecs => 15 min).
// En PROD, les rate limits IP se rebranchent automatiquement.
const IS_PROD = (process.env.NODE_ENV || 'development') === 'production';

const loginLimiter = IS_PROD
  ? rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      message: { success: false, error: { message: 'Trop de tentatives. Reessayez dans 15 minutes.' } },
      standardHeaders: true,
      legacyHeaders: false,
    })
  : (_req: unknown, _res: unknown, next: () => void) => next();

const pinLimiter = IS_PROD
  ? rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 5,
      message: { success: false, error: { message: 'Trop de tentatives PIN. Reessayez dans 1 heure.' } },
      standardHeaders: true,
      legacyHeaders: false,
    })
  : (_req: unknown, _res: unknown, next: () => void) => next();

const router = Router();

router.post('/login', loginLimiter, validate(loginSchema), authController.login);
router.post('/pin-login', pinLimiter, validate(pinLoginSchema), authController.pinLogin);
router.get('/users-list', authController.activeUsers);
router.post('/register', authenticate, authorize('admin'), validate(registerSchema), authController.register);
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.me);

export default router;
