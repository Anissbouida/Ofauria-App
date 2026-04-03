import api from './client';

export const recipesApi = {
  list: () => api.get('/recipes').then(r => r.data.data),
  getById: (id: string) => api.get(`/recipes/${id}`).then(r => r.data.data),
  create: (data: Record<string, unknown>) => api.post('/recipes', data).then(r => r.data.data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/recipes/${id}`, data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/recipes/${id}`),
};
