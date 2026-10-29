import api from './client';

export type SubFrequency = 'monthly' | 'quarterly' | 'yearly';
export interface Subscription {
  id: string; customer_id: string; customer_name: string; label: string;
  amount: number; tva_rate: number; frequency: SubFrequency;
  start_date: string; next_invoice_date: string; end_date: string | null;
  status: 'active' | 'paused' | 'ended'; notes: string | null;
  invoices_count: number; invoiced_total: number;
}
export interface SubscriptionDetail extends Subscription {
  invoices: { period_date: string; amount_ttc: number; generated_at: string; invoice_number: string | null; invoice_status: string | null }[];
}

export const subscriptionsApi = {
  list: (): Promise<Subscription[]> => api.get('/subscriptions').then(r => r.data.data),
  getById: (id: string): Promise<SubscriptionDetail> => api.get(`/subscriptions/${id}`).then(r => r.data.data),
  create: (data: { customerId: string; label: string; amount: number; tvaRate: number; frequency: SubFrequency; startDate: string; endDate?: string | null; notes?: string }): Promise<SubscriptionDetail> =>
    api.post('/subscriptions', data).then(r => r.data.data),
  setStatus: (id: string, status: 'active' | 'paused' | 'ended') => api.post(`/subscriptions/${id}/status`, { status }).then(r => r.data.data),
  generate: (data: { id?: string; asOf?: string }): Promise<{ posted: number }> => api.post('/subscriptions/generate', data).then(r => r.data.data),
};
