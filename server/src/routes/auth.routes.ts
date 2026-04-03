import { Router } from 'express';
import { authController } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { authorize } from '../middleware/role.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { loginSchema, registerSchema } from '../validators/auth.validator.js';

const router = Router();

router.post('/login', validate(loginSchema), authController.login);
router.post('/pin-login', authController.pinLogin);
router.get('/users-list', authController.activeUsers);
router.post('/register', authenticate, authorize('admin'), validate(registerSchema), authController.register);
router.get('/me', authenticate, authController.me);

export default router;
