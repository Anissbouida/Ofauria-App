import api from './client';

export const purchaseOrdersApi = {
  list: (params?: Record<string, string>) =>
    api.get('/purchase-orders', { params }).then(r => r.data.data),
  getById: (id: string) =>
    api.get(`/purchase-orders/${id}`).then(r => r.data.data),
  create: (data: Record<string, unknown>) =>
    api.post('/purchase-orders', data).then(r => r.data.data),
  send: (id: string) =>
    api.post(`/purchase-orders/${id}/send`).then(r => r.data.data),
  confirmDelivery: (id: string, data: { items: { itemId: string; quantityDelivered: number; unitPrice?: number | null; supplierLotNumber?: string; expirationDate?: string; manufacturedDate?: string }[] }) =>
    api.post(`/purchase-orders/${id}/confirm-delivery`, data).then(r => r.data.data),
  markNotDelivered: (id: string) =>
    api.post(`/purchase-orders/${id}/not-delivered`).then(r => r.data.data),
  cancel: (id: string) =>
    api.post(`/purchase-orders/${id}/cancel`).then(r => r.data.data),
  updatePrices: (id: string, data: { items: { itemId: string; unitPrice: number }[] }) =>
    api.post(`/purchase-orders/${id}/update-prices`, data).then(r => r.data.data),
  downloadPdf: (id: string) =>
    api.get(`/purchase-orders/${id}/download-pdf`, { responseType: 'blob' }).then(r => r),
  remove: (id: string) =>
    api.delete(`/purchase-orders/${id}`),
  eligible: () =>
    api.get('/purchase-orders/eligible').then(r => r.data.data),
  overdue: (days?: number) =>
    api.get('/purchase-orders/overdue', { params: days ? { days: String(days) } : undefined }).then(r => r.data.data),
};

export const receptionVouchersApi = {
  list: (params?: Record<string, string>) =>
    api.get('/reception-vouchers', { params }).then(r => r.data.data),
  getById: (id: string) =>
    api.get(`/reception-vouchers/${id}`).then(r => r.data.data),
  create: (data: Record<string, unknown>) =>
    api.post('/reception-vouchers', data).then(r => r.data.data),
  findByPurchaseOrder: (poId: string) =>
    api.get(`/reception-vouchers/purchase-order/${poId}`).then(r => r.data.data),
};
