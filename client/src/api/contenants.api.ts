import api from './client';

export interface BulkResult {
  done: number;
  /** Formats encore references : desactives au lieu d'etre supprimes. */
  deactivated?: number;
  failed: Array<{ id: string; reason: string }>;
}

export const contenantsApi = {
  // Contenants
  list: (includeInactive = false) =>
    api.get(`/contenants${includeInactive ? '?includeInactive=true' : ''}`).then(r => r.data),
  create: (data: Record<string, any>) =>
    api.post('/contenants', data).then(r => r.data),
  update: (id: string, data: Record<string, any>) =>
    api.put(`/contenants/${id}`, data).then(r => r.data),
  deactivate: (id: string) =>
    api.delete(`/contenants/${id}`).then(r => r.data),

  // Actions en masse — renvoient le detail des echecs, un format utilise
  // n'empeche pas les autres d'aboutir.
  bulkDeactivate: (ids: string[]) =>
    api.post('/contenants/bulk-deactivate', { ids }).then(r => r.data.data as BulkResult),
  bulkDelete: (ids: string[]) =>
    api.post('/contenants/bulk-delete', { ids }).then(r => r.data.data as BulkResult),

  // Profils produit
  getProfile: (productId: string) =>
    api.get(`/contenants/products/${productId}`).then(r => r.data),
  upsertProfile: (productId: string, data: Record<string, any>) =>
    api.put(`/contenants/products/${productId}`, data).then(r => r.data),
  deleteProfile: (productId: string) =>
    api.delete(`/contenants/products/${productId}`).then(r => r.data),
};
