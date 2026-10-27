import api from './client';

/** Relances clients et blocage de crédit (mig 366). */
export type DunningStatus = 'draft' | 'sent' | 'resolved' | 'cancelled';
export type DunningSettings = { enabled: boolean; auto_send: boolean; min_amount: number; credit_control: 'warn' | 'block'; auto_release: boolean };
export type DunningProposal = {
  customerId: string; customerName: string; email: string | null; phone: string | null; creditHold: boolean;
  overdue: number; maxDaysLate: number; lastLevel: number | null; lastDunningAt: string | null; targetLevel: number; targetLabel: string;
  docs: { kind: 'invoice' | 'ticket'; number: string; due_date: string; days_late: number; remaining: number }[];
};
export type BlockedCustomer = { id: string; name: string; credit_hold_reason: string | null; credit_hold_at: string | null; dunning_paused_until: string | null; credit_limit: string | null; held_by_name: string | null };
export type Dunning = {
  id: string; number: string; customer_id: string; customer_name: string; customer_email: string | null; level: number; level_label: string;
  dunning_date: string; status: DunningStatus; amount_due: string; fee_amount: string; interest_amount: string; max_days_late: number;
  subject: string; body: string; sent_at: string | null; sent_via: string | null; email_to: string | null; created_by_name: string | null;
  item_count?: number; credit_hold: boolean;
  items?: { id: string; doc_kind: string; doc_number: string; doc_date: string | null; due_date: string; days_late: number; remaining: string }[];
};
export type DunningLevel = {
  level: number; label: string; days_after_due: number; fee_amount: string; interest_rate: string; subject: string; body: string;
  send_email: boolean; credit_hold: boolean; is_active: boolean;
};
export type DunningOverview = { settings: DunningSettings; proposals: DunningProposal[]; drafts: { count: number; amount: number }; blocked: BlockedCustomer[] };

export const DUNNING_STATUS_LABELS: Record<DunningStatus, string> = { draft: 'À envoyer', sent: 'Envoyée', resolved: 'Soldée', cancelled: 'Annulée' };
export const DUNNING_STATUS_TAG: Record<DunningStatus, string> = { draft: 'odoo-tag-orange', sent: 'odoo-tag-blue', resolved: 'odoo-tag-green', cancelled: 'odoo-tag-grey' };

export const dunningApi = {
  overview: (): Promise<DunningOverview> => api.get('/dunning/overview').then(r => r.data.data),
  list: (params: Record<string, string>): Promise<{ data: Dunning[]; total: number }> => api.get('/dunning', { params }).then(r => ({ data: r.data.data, total: r.data.total })),
  get: (id: string): Promise<Dunning> => api.get(`/dunning/${id}`).then(r => r.data.data),
  create: (customerIds: string[], level?: number): Promise<{ data: Dunning[]; errors: { customerId: string; error: string }[] }> =>
    api.post('/dunning/create', { customerIds, level }).then(r => ({ data: r.data.data, errors: r.data.errors })),
  send: (id: string, via: 'email' | 'print' | 'phone' | 'other', emailTo?: string | null): Promise<Dunning> => api.post(`/dunning/${id}/send`, { via, emailTo }).then(r => r.data.data),
  cancel: (id: string) => api.post(`/dunning/${id}/cancel`).then(r => r.data.data),
  pdf: (id: string) => api.get(`/dunning/${id}/pdf`, { responseType: 'blob' }).then(r => r.data as Blob),
  levels: (): Promise<DunningLevel[]> => api.get('/dunning/levels').then(r => r.data.data),
  saveLevel: (level: number, data: Partial<{ label: string; daysAfterDue: number; feeAmount: number; interestRate: number; subject: string; body: string; sendEmail: boolean; creditHold: boolean; isActive: boolean }>) =>
    api.put(`/dunning/levels/${level}`, data).then(r => r.data.data),
  hold: (customerId: string, reason: string) => api.post(`/dunning/customers/${customerId}/hold`, { reason }),
  release: (customerId: string) => api.post(`/dunning/customers/${customerId}/release`),
  pause: (customerId: string, until: string | null) => api.post(`/dunning/customers/${customerId}/pause`, { until }),
};
