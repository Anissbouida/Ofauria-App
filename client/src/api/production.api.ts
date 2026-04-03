import api from './client';

export const productionApi = {
  list: (params?: Record<string, string>) => api.get('/production', { params }).then(r => r.data),
  getById: (id: string) => api.get(`/production/${id}`).then(r => r.data.data),
  create: (data: Record<string, unknown>) => api.post('/production', data).then(r => r.data.data),
  updateItems: (id: string, items: Record<string, unknown>[]) => api.put(`/production/${id}/items`, { items }).then(r => r.data.data),
  confirm: (id: string) => api.post(`/production/${id}/confirm`).then(r => r.data),
  start: (id: string) => api.post(`/production/${id}/start`).then(r => r.data.data),
  complete: (id: string, items: { planItemId: string; actualQuantity: number }[]) =>
    api.post(`/production/${id}/complete`, { items }).then(r => r.data.data),
  remove: (id: string) => api.delete(`/production/${id}`),
};
