import api from './client';

export const salesApi = {
  list: (params?: Record<string, string>) => api.get('/sales', { params }).then(r => r.data),
  getById: (id: string) => api.get(`/sales/${id}`).then(r => r.data.data),
  checkout: (data: Record<string, unknown>) => api.post('/sales/checkout', data).then(r => r.data.data),
  todayStats: () => api.get('/sales/today').then(r => r.data.data),
  summary: (params: Record<string, string>) => api.get('/sales/summary', { params }).then(r => r.data.data),
};
