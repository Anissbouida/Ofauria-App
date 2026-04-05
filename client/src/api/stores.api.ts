import api from './client';

export const storesApi = {
  list: () => api.get('/stores').then(r => r.data.data),
  getById: (id: string) => api.get(`/stores/${id}`).then(r => r.data.data),
  create: (data: Record<string, unknown>) => api.post('/stores', data).then(r => r.data.data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/stores/${id}`, data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/stores/${id}`),
};
