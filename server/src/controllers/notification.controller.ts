import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.middleware.js';
import { notificationRepository } from '../repositories/notification.repository.js';

export const notificationController = {
  async list(req: AuthRequest, res: Response) {
    const { unreadOnly, page = '1', limit = '30' } = req.query as Record<string, string>;
    const p = parseInt(page);
    const l = parseInt(limit);

    const result = await notificationRepository.findForUser({
      role: req.user!.role,
      userId: req.user!.userId,
      storeId: req.user!.storeId,
      unreadOnly: unreadOnly === 'true',
      limit: l,
      offset: (p - 1) * l,
    });

    res.json({
      success: true,
      data: result.rows,
      total: result.total,
      page: p,
      limit: l,
      totalPages: Math.ceil(result.total / l),
    });
  },

  async unreadCount(req: AuthRequest, res: Response) {
    // Sync: generate missing notifications for active production plans
    // This runs on each poll but is fast (single indexed query, no-ops if up to date)
    await notificationRepository.syncProductionNotifications(req.user!.role, req.user!.storeId);

    const count = await notificationRepository.countUnread(
      req.user!.role,
      req.user!.userId,
      req.user!.storeId,
    );
    res.json({ success: true, data: { count } });
  },

  async markAsRead(req: AuthRequest, res: Response) {
    await notificationRepository.markAsRead(req.params.id, req.user!.userId);
    res.json({ success: true, data: null });
  },

  async markAllAsRead(req: AuthRequest, res: Response) {
    await notificationRepository.markAllAsRead(
      req.user!.role,
      req.user!.userId,
      req.user!.storeId,
    );
    res.json({ success: true, data: null });
  },
};
