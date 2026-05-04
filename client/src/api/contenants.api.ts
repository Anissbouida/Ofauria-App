import api from './client';

export const contenantsApi = {
  // Contenants
  list: (includeInactive = false) =>
    api.get(`/contenants${includeInactive ? '?includeInactive=true' : ''}`).then(r => r.data),
  getById: (id: string) =>
    api.get(`/contenants/${id}`).then(r => r.data),
  create: (data: Record<string, unknown>) =>
    api.post('/contenants', data).then(r => r.data),
  update: (id: string, data: Record<string, unknown>) =>
    api.put(`/contenants/${id}`, data).then(r => r.data),
  deactivate: (id: string) =>
    api.delete(`/contenants/${id}`).then(r => r.data),

  // Profils produit
  getProfile: (productId: string) =>
    api.get(`/contenants/products/${productId}`).then(r => r.data),
  upsertProfile: (productId: string, data: Record<string, unknown>) =>
    api.put(`/contenants/products/${productId}`, data).then(r => r.data),
  deleteProfile: (productId: string) =>
    api.delete(`/contenants/products/${productId}`).then(r => r.data),
};
