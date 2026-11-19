import { Router } from 'express';
import { notificationController } from '../controllers/notification.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { emptyBody } from '../validators/common.validator.js';

const router = Router();

router.get('/', authenticate, notificationController.list);
router.get('/unread-count', authenticate, notificationController.unreadCount);
router.put('/read-all', authenticate, validate(emptyBody), notificationController.markAllAsRead);
router.put('/:id/read', authenticate, validate(emptyBody), notificationController.markAsRead);

export default router;
