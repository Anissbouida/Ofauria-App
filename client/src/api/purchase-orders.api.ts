import api from './client';

export const purchaseOrdersApi = {
  list: (params?: Record<string, string>) =>
    api.get('/purchase-orders', { params }).then(r => r.data.data),
  getById: (id: string) =>
    api.get(`/purchase-orders/${id}`).then(r => r.data.data),
  create: (data: Record<string, unknown>) =>
    api.post('/purchase-orders', data).then(r => r.data.data),
  send: (id: string) =>
    api.post(`/purchase-orders/${id}/send`).then(r => r.data.data),
  confirmDelivery: (id: string, data: { items: { itemId: string; quantityDelivered: number }[] }) =>
    api.post(`/purchase-orders/${id}/confirm-delivery`, data).then(r => r.data.data),
  markNotDelivered: (id: string) =>
    api.post(`/purchase-orders/${id}/not-delivered`).then(r => r.data.data),
  cancel: (id: string) =>
    api.post(`/purchase-orders/${id}/cancel`).then(r => r.data.data),
  remove: (id: string) =>
    api.delete(`/purchase-orders/${id}`),
  overdue: (days?: number) =>
    api.get('/purchase-orders/overdue', { params: days ? { days: String(days) } : undefined }).then(r => r.data.data),
};
