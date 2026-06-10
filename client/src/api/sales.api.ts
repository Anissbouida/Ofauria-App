import api from './client';

export const salesApi = {
  list: (params?: Record<string, string>) => api.get('/sales', { params }).then(r => r.data),
  getById: (id: string) => api.get(`/sales/${id}`).then(r => r.data.data),
  checkout: (data: Record<string, any>) => api.post('/sales/checkout', data).then(r => r.data.data),
  pay: (id: string, data: { paymentMethod: string; paidAt?: string }) => api.post(`/sales/${id}/pay`, data).then(r => r.data.data),
  deferred: () => api.get('/sales/deferred').then(r => r.data.data),
  todayStats: () => api.get('/sales/today').then(r => r.data.data),
  summary: (params: Record<string, string>) => api.get('/sales/summary', { params }).then(r => r.data.data),
  importCSV: (data: { days: { date: string; items: { sku: string; productName: string; quantity: number; unitPrice: number; netSales: number; costOfGoods: number }[] }[] }) =>
    api.post('/sales/import', data).then(r => r.data.data),
  // Vente speciale B2B : prix unitaires negocies, pas de stock vitrine deduit.
  createSpecial: (data: {
    customerId: string;
    items: { productId: string; quantity: number; unitPrice: number }[];
    paymentMethod: string;
    paymentStatus?: 'paid' | 'unpaid';
    discountAmount?: number;
    notes?: string;
    saleDate?: string;
  }) => api.post('/sales/special', data).then(r => r.data.data),
  updateSpecial: (id: string, data: {
    customerId: string;
    items: { productId: string; quantity: number; unitPrice: number }[];
    paymentMethod: string;
    paymentStatus?: 'paid' | 'unpaid';
    discountAmount?: number;
    notes?: string;
    saleDate?: string;
  }) => api.put(`/sales/special/${id}`, data).then(r => r.data.data),
  deleteSpecial: (id: string) => api.delete(`/sales/special/${id}`).then(r => r.data),
};
