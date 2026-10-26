import api from './client';

export const ordersApi = {
  list: (params?: Record<string, string>) => api.get('/orders', { params }).then(r => r.data),
  getById: (id: string) => api.get(`/orders/${id}`).then(r => r.data.data),
  create: (data: Record<string, any>) => api.post('/orders', data).then(r => r.data.data),
  update: (id: string, data: Record<string, any>) => api.put(`/orders/${id}`, data).then(r => r.data.data),
  updateStatus: (id: string, status: string, reason?: string) => api.put(`/orders/${id}/status`, { status, reason }).then(r => r.data.data),
  /** Report de la date de retrait (≥ 24 h avant, sinon direction avec motif). */
  reschedule: (id: string, data: { newPickupDate: string; reason?: string }) => api.post(`/orders/${id}/reschedule`, data).then(r => r.data.data),
  deliver: (id: string, data: { amountPaid: number; paymentMethod: string }) => api.post(`/orders/${id}/deliver`, data).then(r => r.data.data),
  forDate: (date: string) => api.get('/orders/for-date', { params: { date } }).then(r => r.data.data),
  remove: (id: string) => api.delete(`/orders/${id}`).then(r => r.data.data),
};
