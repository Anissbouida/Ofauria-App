import api from './client';

export const usersApi = {
  list: () => api.get('/users').then(r => r.data.data),
  create: (data: Record<string, unknown>) => api.post('/users', data).then(r => r.data.data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/users/${id}`, data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/users/${id}`),
};
