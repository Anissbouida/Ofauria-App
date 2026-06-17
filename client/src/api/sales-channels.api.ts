import api from './client';

export interface SalesChannel {
  id: string;
  code: string;
  label: string;
  color: string;
  is_default: boolean;
  is_active: boolean;
  display_order: number;
  created_at?: string;
  updated_at?: string;
}

export const salesChannelsApi = {
  list: () => api.get('/sales-channels').then(r => r.data.data as SalesChannel[]),
  listActive: () => api.get('/sales-channels/active').then(r => r.data.data as SalesChannel[]),
  create: (data: { code: string; label: string; color?: string; displayOrder?: number; isDefault?: boolean }) =>
    api.post('/sales-channels', data).then(r => r.data.data as SalesChannel),
  update: (id: string, data: Partial<{ label: string; color: string; displayOrder: number; isDefault: boolean; isActive: boolean }>) =>
    api.put(`/sales-channels/${id}`, data).then(r => r.data.data as SalesChannel),
  deactivate: (id: string) => api.delete(`/sales-channels/${id}`),
};
