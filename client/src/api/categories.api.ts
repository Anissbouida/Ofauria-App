import api from './client';

export const categoriesApi = {
  list: () => api.get('/categories').then(r => r.data.data),
  create: (data: Record<string, unknown>) => api.post('/categories', data).then(r => r.data.data),
  update: (id: number, data: Record<string, unknown>) => api.put(`/categories/${id}`, data).then(r => r.data.data),
  remove: (id: number) => api.delete(`/categories/${id}`),
};
