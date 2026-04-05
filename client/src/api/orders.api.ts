import api from './client';

export const ordersApi = {
  list: (params?: Record<string, string>) => api.get('/orders', { params }).then(r => r.data),
  getById: (id: string) => api.get(`/orders/${id}`).then(r => r.data.data),
  create: (data: Record<string, unknown>) => api.post('/orders', data).then(r => r.data.data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/orders/${id}`, data).then(r => r.data.data),
  updateStatus: (id: string, status: string) => api.put(`/orders/${id}/status`, { status }).then(r => r.data.data),
  deliver: (id: string, data: { amountPaid: number; paymentMethod: string }) => api.post(`/orders/${id}/deliver`, data).then(r => r.data.data),
  forDate: (date: string) => api.get('/orders/for-date', { params: { date } }).then(r => r.data.data),
};
