import api from './client';

export const usersApi = {
  list: () => api.get('/users').then(r => r.data.data),
  create: (data: Record<string, unknown>) => api.post('/users', data).then(r => r.data.data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/users/${id}`, data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/users/${id}`),
  getPermissions: (id: string) => api.get(`/users/${id}/permissions`).then(r => r.data.data),
  setPermissions: (id: string, permissions: Record<string, unknown>[]) =>
    api.put(`/users/${id}/permissions`, { permissions }).then(r => r.data.data),
  myPermissions: () => api.get('/users/me/permissions').then(r => r.data.data),
};
