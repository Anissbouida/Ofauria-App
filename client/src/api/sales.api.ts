import api from './client';

export const salesApi = {
  list: (params?: Record<string, string>) => api.get('/sales', { params }).then(r => r.data),
  getById: (id: string) => api.get(`/sales/${id}`).then(r => r.data.data),
  checkout: (data: Record<string, any>) => api.post('/sales/checkout', data).then(r => r.data.data),
  /** Règles de caisse (mig 374). */
  posRules: (): Promise<{ sellWithoutStock: boolean; personSizes: number[] }> => api.get('/sales/pos-rules').then(r => r.data.data),
  pay: (id: string, data: { paymentMethod: string; paidAt?: string }) => api.post(`/sales/${id}/pay`, data).then(r => r.data.data),
  /** Facture depuis un ticket (phase 5.5) : pièce légale pour une vente déjà encaissée. */
  invoice: (id: string, customerId?: string) => api.post(`/sales/${id}/invoice`, customerId ? { customerId } : {}).then(r => r.data.data),
  deferred: () => api.get('/sales/deferred').then(r => r.data.data),
  /** Créances clients (mig 351) : balance âgée, tickets impayés + factures clients ouvertes. */
  receivables: () => api.get('/sales/receivables').then(r => r.data.data as ReceivablesReport),
  todayStats: () => api.get('/sales/today').then(r => r.data.data),
  summary: (params: Record<string, string>) => api.get('/sales/summary', { params }).then(r => r.data.data),
  importCSV: (data: { days: { date: string; items: { sku: string; productName: string; quantity: number; unitPrice: number; netSales: number; costOfGoods: number }[] }[] }) =>
    api.post('/sales/import', data).then(r => r.data.data),
};

export type AgingBucket = 'current' | 'd30' | 'd60' | 'd90' | 'over90';
export interface ReceivableDoc {
  kind: 'ticket' | 'invoice'; id: string; number: string; customer_id: string | null; legacy_name: string | null;
  doc_date: string; due_date: string; days_late: number; amount: number; paid: number; remaining: number; bucket: AgingBucket;
  ledger_posted: boolean;            // false : ticket à crédit antérieur au lot L5, au grand livre seulement à l'encaissement
}
export interface CustomerReceivable {
  customerId: string | null; name: string; phone: string | null; customerType: string | null; creditLimit: number | null;
  total: number; overdue: number; buckets: Record<AgingBucket, number>; oldestDue: string | null; maxDaysLate: number; docs: ReceivableDoc[];
  // Rapprochement avec le compte clients 3421 (G-CA-05) : null pour un impayé sans fiche client.
  ledgerBalance: number | null; gap: number | null; legacyTickets: number;
}
/** Pièces de gestion ↔ compte clients 3421 : une seule vue des créances (G-CA-05). */
export interface ReceivablesReconciliation {
  documents: number;                 // dû par pièces (tickets + factures ouvertes − avoirs non imputés), tous magasins
  ledger: number;                    // solde du compte clients 3421 (lignes des tiers, fenêtre de cumul)
  gap: number;                       // documents − ledger : 0 quand tout est comptabilisé
  legacyTickets: number;             // tickets à crédit antérieurs au lot L5 : au grand livre à l'encaissement seulement
  unassigned: number;                // impayés sans fiche client : jamais au grand livre
  unappliedCredits: number;          // avoirs émis non imputés
  gapCustomers: number;
}
export interface ReceivablesReport {
  asOf: string;
  totals: { total: number; overdue: number; buckets: Record<AgingBucket, number>; customers: number; documents: number };
  reconciliation: ReceivablesReconciliation;
  customers: CustomerReceivable[];
}
