import api from './client';

export const customersApi = {
  list: (params?: Record<string, string>) => api.get('/customers', { params }).then(r => r.data),
  getById: (id: string) => api.get(`/customers/${id}`).then(r => r.data.data),
  /** Situation du client (mig 351) : dû, échu, plafond de crédit, disponible. */
  situation: (id: string) => api.get(`/customers/${id}/situation`).then(r => r.data.data as {
    total: number; overdue: number; creditLimit: number | null; available: number | null; paymentTermDays: number; maxDaysLate: number;
  }),
  /** Relevé de compte (factures + règlements, solde glissant) sur une période. */
  statement: (id: string, from?: string, to?: string) =>
    api.get(`/customers/${id}/statement`, { params: { from, to } }).then(r => r.data.data as CustomerStatement),
  stats: (id: string) => api.get(`/customers/${id}/stats`).then(r => r.data.data),
  globalStats: () => api.get('/customers/global-stats').then(r => r.data.data),
  create: (data: Record<string, any>) => api.post('/customers', data).then(r => r.data.data),
  update: (id: string, data: Record<string, any>) => api.put(`/customers/${id}`, data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/customers/${id}`),
};

export interface StatementEntry {
  date: string; kind: 'invoice' | 'payment'; label: string; number: string;
  debit: number; credit: number; balance: number;
}
export interface CustomerStatement {
  customer: { id: string; name: string; email: string | null; phone: string | null; ice: string | null; address: string | null; city: string | null };
  from: string; to: string;
  opening: number; closing: number; totalDebit: number; totalCredit: number;
  entries: StatementEntry[];
}
