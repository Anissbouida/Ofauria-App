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
  /** Archivage + audit (phase 4.4) */
  restore: (id: string) => api.post(`/customers/${id}/restore`).then(r => r.data),
  /** Protection des données — loi 09-08 (phase 4.6) */
  setConsent: (id: string, marketingConsent: boolean) => api.put(`/customers/${id}/consent`, { marketingConsent }).then(r => r.data),
  exportData: (id: string) => api.get(`/customers/${id}/export`).then(r => r.data.data),
  anonymize: (id: string) => api.post(`/customers/${id}/anonymize`).then(r => r.data),
  history: (id: string) => api.get(`/customers/${id}/history`).then(r => r.data.data as Array<{ id: string; action: string; changed_at: string; changed_by_name: string | null; detail: Record<string, any> }>),
  /** Doublons probables (phase 4.3) : même ICE ou même nom. */
  check: (params: { ice?: string; name?: string; excludeId?: string }) =>
    api.get('/customers/check', { params }).then(r => r.data.data as Array<{ id: string; name: string; reason: string }>),
  // Adresses multiples (phase 4.1)
  listAddresses: (id: string) => api.get(`/customers/${id}/addresses`).then(r => r.data.data as CustomerAddress[]),
  createAddress: (id: string, data: Record<string, any>) => api.post(`/customers/${id}/addresses`, data).then(r => r.data.data as CustomerAddress),
  updateAddress: (id: string, addressId: string, data: Record<string, any>) => api.put(`/customers/${id}/addresses/${addressId}`, data).then(r => r.data.data as CustomerAddress),
  removeAddress: (id: string, addressId: string) => api.delete(`/customers/${id}/addresses/${addressId}`),
};

export interface CustomerAddress {
  id: string;
  customer_id: string;
  label: string | null;
  kind: 'delivery' | 'billing' | 'both';
  address_line: string;
  postal_code: string | null;
  city: string | null;
  country_code: string;
  is_default_delivery: boolean;
  is_default_billing: boolean;
  is_active: boolean;
}

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
