import { Router } from 'express';
import { notificationController } from '../controllers/notification.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/', authenticate, notificationController.list);
router.get('/unread-count', authenticate, notificationController.unreadCount);
router.put('/read-all', authenticate, notificationController.markAllAsRead);
router.put('/:id/read', authenticate, notificationController.markAsRead);

export default router;
