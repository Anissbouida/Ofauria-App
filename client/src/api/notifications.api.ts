import api from './client';

export interface Notification {
  id: string;
  target_role: string;
  target_user_id: string | null;
  store_id: string | null;
  type: string;
  title: string;
  message: string;
  reference_type: string | null;
  reference_id: string | null;
  created_by: string | null;
  creator_first_name: string | null;
  creator_last_name: string | null;
  read_by: string[];
  created_at: string;
}

export const notificationsApi = {
  list: (params?: Record<string, string>) =>
    api.get('/notifications', { params }).then(r => r.data),

  unreadCount: () =>
    api.get('/notifications/unread-count').then(r => r.data.data.count as number),

  markAsRead: (id: string) =>
    api.put(`/notifications/${id}/read`).then(r => r.data),

  markAllAsRead: () =>
    api.put('/notifications/read-all').then(r => r.data),
};
