import api from './client';

export const customersApi = {
  list: (params?: Record<string, string>) => api.get('/customers', { params }).then(r => r.data),
  getById: (id: string) => api.get(`/customers/${id}`).then(r => r.data.data),
  stats: (id: string) => api.get(`/customers/${id}/stats`).then(r => r.data.data),
  globalStats: () => api.get('/customers/global-stats').then(r => r.data.data),
  create: (data: Record<string, unknown>) => api.post('/customers', data).then(r => r.data.data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/customers/${id}`, data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/customers/${id}`),
};
