import api from './client';

export const replenishmentApi = {
  list: (params?: Record<string, string>) => api.get('/replenishment', { params }).then(r => r.data),
  getById: (id: string) => api.get(`/replenishment/${id}`).then(r => r.data.data),
  checkToday: () => api.get('/replenishment/check-today').then(r => r.data.data),
  checkItems: (productIds: string[]) => api.post('/replenishment/check-items', { productIds }).then(r => r.data.data),
  closingInventory: () => api.get('/replenishment/closing-inventory').then(r => r.data.data),
  create: (data: Record<string, unknown>) => api.post('/replenishment', data).then(r => r.data.data),
  // Step 2: Acknowledge
  acknowledge: (id: string) => api.post(`/replenishment/${id}/acknowledge`).then(r => r.data.data),
  // Step 3: Start preparing
  startPreparing: (id: string, items: { itemId: string; qtyToStore: number; qtyToStock: number; source: string }[]) =>
    api.post(`/replenishment/${id}/prepare`, { items }).then(r => r.data.data),
  // Step 4: Transfer
  transfer: (id: string) => api.post(`/replenishment/${id}/transfer`).then(r => r.data.data),
  // Step 5: Confirm reception
  confirmReception: (id: string, items: { itemId: string; qtyReceived: number; notes?: string }[]) =>
    api.post(`/replenishment/${id}/confirm-reception`, { items }).then(r => r.data.data),
  cancel: (id: string) => api.post(`/replenishment/${id}/cancel`).then(r => r.data),
  pendingTransfers: () => api.get('/replenishment/pending-transfers').then(r => r.data.data),
  recommendations: () => api.get('/replenishment/recommendations').then(r => r.data.data),
  saveInventoryCheck: (data: { sessionId?: string; items: { productId: string; productName: string; replenishedQty: number; soldQty: number; remainingQty: number; destination?: string }[]; notes?: string }) =>
    api.post('/replenishment/inventory-check', data).then(r => r.data.data),
};
