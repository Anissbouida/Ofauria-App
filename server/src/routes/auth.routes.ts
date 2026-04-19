import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authController } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { loginSchema, registerSchema } from '../validators/auth.validator.js';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // max 10 attempts per window
  message: { success: false, error: { message: 'Trop de tentatives de connexion. Reessayez dans 15 minutes.' } },
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();

router.post('/login', authLimiter, validate(loginSchema), authController.login);
router.post('/pin-login', authLimiter, authController.pinLogin);
router.get('/users-list', authController.activeUsers);
router.post('/register', authenticate, authorize('admin'), validate(registerSchema), authController.register);
router.get('/me', authenticate, authController.me);

export default router;
