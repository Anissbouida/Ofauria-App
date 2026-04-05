import { notificationRepository } from '../repositories/notification.repository.js';

/**
 * Create a notification without throwing — notifications should never
 * cause the parent operation to fail.
 */
export async function createNotification(data: {
  targetRole: string;
  targetUserId?: string;
  storeId?: string;
  type: string;
  title: string;
  message: string;
  referenceType?: string;
  referenceId?: string;
  createdBy?: string;
}) {
  try {
    await notificationRepository.create(data);
  } catch (err) {
    console.error('[notify] Failed to create notification:', err);
  }
}
