import api from './client';

export const purchaseRequestsApi = {
  list: (params?: Record<string, string>) =>
    api.get('/purchase-requests', { params }).then(r => r.data.data),
  grouped: () =>
    api.get('/purchase-requests/grouped').then(r => r.data.data),
  count: () =>
    api.get('/purchase-requests/count').then(r => r.data.data),
  create: (data: {
    ingredientId: string;
    supplierId?: string | null;
    quantity: number;
    unit: string;
    reason?: string;
    note?: string;
  }) => api.post('/purchase-requests', data).then(r => r.data.data),
  updateQuantity: (id: string, quantity: number) =>
    api.put(`/purchase-requests/${id}/quantity`, { quantity }).then(r => r.data.data),
  cancel: (id: string, note?: string) =>
    api.post(`/purchase-requests/${id}/cancel`, { note }).then(r => r.data.data),
  generatePO: (data: {
    supplierId: string;
    requestIds: string[];
    expectedDeliveryDate?: string;
    notes?: string;
    quantityOverrides?: Record<string, number>;
  }) => api.post('/purchase-requests/generate-po', data).then(r => r.data.data),
};
