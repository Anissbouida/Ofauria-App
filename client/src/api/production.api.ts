import api from './client';

export const productionApi = {
  list: (params?: Record<string, string>) => api.get('/production', { params }).then(r => r.data),
  getById: (id: string) => api.get(`/production/${id}`).then(r => r.data.data),
  create: (data: Record<string, unknown>) => api.post('/production', data).then(r => r.data.data),
  updateItems: (id: string, items: Record<string, unknown>[]) => api.put(`/production/${id}/items`, { items }).then(r => r.data.data),
  confirm: (id: string) => api.post(`/production/${id}/confirm`).then(r => r.data),
  start: (id: string) => api.post(`/production/${id}/start`).then(r => r.data.data),
  startItems: (id: string, itemIds: string[], startedAt?: string) =>
    api.post(`/production/${id}/start-items`, { itemIds, startedAt }).then(r => r.data),
  produceItems: (id: string, items: { planItemId: string; actualQuantity: number }[], producedAt?: string) =>
    api.post(`/production/${id}/produce-items`, { items, producedAt }).then(r => r.data),
  transferItems: (id: string, itemIds: string[]) =>
    api.post(`/production/${id}/transfer-items`, { itemIds }).then(r => r.data),
  pendingTransfers: () => api.get('/production/transfers/pending').then(r => r.data.data),
  confirmTransferReception: (transferId: string, items: { itemId: string; qtyReceived: number; notes?: string }[]) =>
    api.post(`/production/transfers/${transferId}/receive`, { items }).then(r => r.data),
  restoreItems: (id: string, itemIds: string[]) =>
    api.post(`/production/${id}/restore-items`, { itemIds }).then(r => r.data),
  cancelItems: (id: string, itemIds: string[], reason?: string) =>
    api.post(`/production/${id}/cancel-items`, { itemIds, reason }).then(r => r.data),
  complete: (id: string, items: { planItemId: string; actualQuantity: number }[], completionType?: string) =>
    api.post(`/production/${id}/complete`, { items, completionType }).then(r => r.data),
  analyzeSubRecipes: (id: string) => api.get(`/production/${id}/sub-recipe-analysis`).then(r => r.data.data),
  remove: (id: string) => api.delete(`/production/${id}`),
};
