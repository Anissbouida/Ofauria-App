import api from './client';

/** Devis clients et proforma (mig 365). */
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'refused' | 'expired' | 'converted' | 'cancelled';
export type QuoteItem = {
  id: string; product_id: string; product_name: string; description: string | null; quantity: number; unit_price: string;
  tva_rate: string | null; subtotal: string; catalog_price: string;
};
export type QuoteEvent = { id: string; event_type: string; from_value: string | null; to_value: string | null; note: string | null; by_name: string | null; created_at: string };
export type Quote = {
  id: string; number: string; status: QuoteStatus; title: string | null; client_label: string | null;
  customer_id: string | null; customer_type: string | null; prospect_name: string | null; prospect_company: string | null; prospect_phone: string | null; prospect_email: string | null;
  customer_email: string | null; customer_phone: string | null;
  quote_date: string; valid_until: string; with_tax: boolean; discount_pct: string; subtotal: string; discount_amount: string; promotion_amount?: string; tax_amount: string; total: string;
  delivery_terms: string | null; notes: string | null; internal_notes: string | null;
  sent_at: string | null; decided_at: string | null; lost_reason_code: string | null; lost_reason_label: string | null; lost_note: string | null;
  order_id: string | null; order_number: string | null; proforma_number: string | null; revision_of: string | null;
  created_by_name: string | null; created_at: string; item_count: number; is_overdue: boolean; expires_soon: boolean;
  items?: QuoteItem[]; events?: QuoteEvent[];
};
export type QuoteInput = {
  customerId?: string | null; prospectName?: string | null; prospectCompany?: string | null; prospectPhone?: string | null; prospectEmail?: string | null;
  title?: string | null; opportunityId?: string | null; quoteDate?: string; validUntil?: string; withTax?: boolean; discountPct?: number;
  deliveryTerms?: string | null; notes?: string | null; internalNotes?: string | null;
  items: { productId: string; quantity: number; unitPrice?: number | null; tvaRate?: number | null; description?: string | null }[];
};
export type QuotesOverview = {
  byStatus: Record<string, { count: number; amount: number; overdue: number; expiring: number }>;
  conversion: { won: number; lost: number; wonAmount: number; lostAmount: number; rate: number | null };
  lostByReason: { label: string; count: number; amount: number }[];
  validityDays: number;
};

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: 'Brouillon', sent: 'Envoyé', accepted: 'Accepté', refused: 'Perdu', expired: 'Expiré', converted: 'Commandé', cancelled: 'Annulé',
};
export const QUOTE_STATUS_TAG: Record<QuoteStatus, string> = {
  draft: 'odoo-tag-grey', sent: 'odoo-tag-blue', accepted: 'odoo-tag-green', refused: 'odoo-tag-red', expired: 'odoo-tag-orange', converted: 'odoo-tag-purple', cancelled: 'odoo-tag-grey',
};

export const quotesApi = {
  list: (params: Record<string, string>): Promise<{ data: Quote[]; total: number }> => api.get('/quotes', { params }).then(r => ({ data: r.data.data, total: r.data.total })),
  overview: (): Promise<QuotesOverview> => api.get('/quotes/overview').then(r => r.data.data),
  get: (id: string): Promise<Quote> => api.get(`/quotes/${id}`).then(r => r.data.data),
  create: (data: QuoteInput): Promise<Quote> => api.post('/quotes', data).then(r => r.data.data),
  update: (id: string, data: QuoteInput): Promise<Quote> => api.put(`/quotes/${id}`, data).then(r => r.data.data),
  action: (id: string, action: 'send' | 'accept' | 'refuse' | 'reopen' | 'cancel', data: { reasonCode?: string | null; note?: string | null } = {}): Promise<Quote> =>
    api.post(`/quotes/${id}/${action}`, data).then(r => r.data.data),
  duplicate: (id: string): Promise<Quote> => api.post(`/quotes/${id}/duplicate`).then(r => r.data.data),
  convert: (id: string, data: { pickupDate: string; customerId?: string | null }):
    Promise<{ data: Quote; order: { id: string; orderNumber: string; total: number }; creditWarning: { message: string } | null }> =>
    api.post(`/quotes/${id}/convert`, data).then(r => r.data),
  pdf: (id: string, kind: 'quote' | 'proforma') => api.get(`/quotes/${id}/pdf`, { params: { kind }, responseType: 'blob' }).then(r => r.data as Blob),
};
