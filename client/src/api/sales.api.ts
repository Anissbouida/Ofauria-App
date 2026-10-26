import api from './client';

export const salesApi = {
  list: (params?: Record<string, string>) => api.get('/sales', { params }).then(r => r.data),
  getById: (id: string) => api.get(`/sales/${id}`).then(r => r.data.data),
  checkout: (data: Record<string, any>) => api.post('/sales/checkout', data).then(r => r.data.data),
  pay: (id: string, data: { paymentMethod: string; paidAt?: string }) => api.post(`/sales/${id}/pay`, data).then(r => r.data.data),
  deferred: () => api.get('/sales/deferred').then(r => r.data.data),
  /** Créances clients (mig 351) : balance âgée, tickets impayés + factures clients ouvertes. */
  receivables: () => api.get('/sales/receivables').then(r => r.data.data as ReceivablesReport),
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

export type AgingBucket = 'current' | 'd30' | 'd60' | 'd90' | 'over90';
export interface ReceivableDoc {
  kind: 'ticket' | 'invoice'; id: string; number: string; customer_id: string | null; legacy_name: string | null;
  doc_date: string; due_date: string; days_late: number; amount: number; paid: number; remaining: number; bucket: AgingBucket;
}
export interface CustomerReceivable {
  customerId: string | null; name: string; phone: string | null; customerType: string | null; creditLimit: number | null;
  total: number; overdue: number; buckets: Record<AgingBucket, number>; oldestDue: string | null; maxDaysLate: number; docs: ReceivableDoc[];
}
export interface ReceivablesReport {
  asOf: string;
  totals: { total: number; overdue: number; buckets: Record<AgingBucket, number>; customers: number; documents: number };
  customers: CustomerReceivable[];
}
