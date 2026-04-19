import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authController } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { loginSchema, registerSchema, pinLoginSchema } from '../validators/auth.validator.js';

// OWASP A07 : rate limiters par IP.
// Lockout par compte (A04-2) complete cette limite IP-based.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: { message: 'Trop de tentatives. Reessayez dans 15 minutes.' } },
  standardHeaders: true,
  legacyHeaders: false,
});

// PIN : espace de cles plus petit (10^6 = 1M pour 6 chiffres),
// on durcit le rate limit par rapport au login email/password.
const pinLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1h
  max: 5,
  message: { success: false, error: { message: 'Trop de tentatives PIN. Reessayez dans 1 heure.' } },
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();

router.post('/login', loginLimiter, validate(loginSchema), authController.login);
router.post('/pin-login', pinLimiter, validate(pinLoginSchema), authController.pinLogin);
router.get('/users-list', authController.activeUsers);
router.post('/register', authenticate, authorize('admin'), validate(registerSchema), authController.register);
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.me);

export default router;
