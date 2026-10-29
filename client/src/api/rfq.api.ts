import api from './client';

/** Appels d'offres fournisseurs (mig 360). */
export type RfqStatus = 'draft' | 'sent' | 'quoted' | 'awarded' | 'cancelled' | 'closed';
export type LineType = 'ingredient' | 'consumable' | 'service' | 'asset';

export type RfqItem = {
  id: string; rfq_id: string; line_type: LineType; ingredient_id: string | null; packaging_id: string | null; description: string | null;
  category_id: string | null; category_name: string | null; unit: string | null; unit_label: string | null; quantity: string; display_order: number;
  label: string; last_price: string | null;
};
export type RfqSupplier = {
  id: string; supplier_id: string; supplier_name: string; email: string | null; phone: string | null; contact_name: string | null;
  status: 'invited' | 'quoted' | 'declined' | 'no_response'; invited_at: string | null; contact_note: string | null; quotation_id: string | null;
  supplier_currency?: string | null;
};
export type QuotationLine = { id: string; quotation_id: string; rfq_item_id: string; available: boolean; unit_price: string | null; foreign_unit_price?: string | null; quantity: string | null; note: string | null };
export type Quotation = {
  id: string; rfq_id: string; supplier_id: string; supplier_name: string; quotation_ref: string | null; received_at: string; valid_until: string | null;
  delivery_days: number | null; payment_terms: string | null; shipping_cost: string; discount_pct: string; notes: string | null;
  status: 'received' | 'selected' | 'rejected'; created_by_name: string | null; lines: QuotationLine[];
  subtotal: string; discount_amount: string; total_ht: string; covered: number; complete: boolean;
  /** Devise du devis (mig 363) : unit_price et total_ht en DH, foreign_unit_price / total_foreign / shipping_cost en devise. */
  currency_code?: string; exchange_rate?: string; total_foreign?: string | null;
};
export type Rfq = {
  id: string; number: string; title: string; status: RfqStatus; needed_by: string | null; response_deadline: string | null; notes: string | null;
  sent_at: string | null; awarded_at: string | null; awarded_quotation_id: string | null; purchase_order_id: string | null; purchase_order_number: string | null;
  awarded_supplier_id: string | null; awarded_supplier_name: string | null; created_by_name: string | null; created_at: string;
  item_count: number; supplier_count: number; quotation_count: number; is_overdue: boolean;
  items?: RfqItem[]; suppliers?: RfqSupplier[]; quotations?: Quotation[];
  best_by_item?: Record<string, { quotationId: string; unitPrice: number } | null>; best_total_quotation_id?: string | null;
};
export type RfqItemInput = { lineType?: LineType; ingredientId?: string | null; packagingId?: string | null; description?: string | null; categoryId?: string | null; unit?: string | null; quantity: number };
export type RfqInput = { title: string; neededBy?: string | null; responseDeadline?: string | null; notes?: string | null; items: RfqItemInput[]; supplierIds: string[] };
export type QuotationInput = {
  supplierId: string; quotationRef?: string | null; receivedAt?: string; validUntil?: string | null; deliveryDays?: number | null; paymentTerms?: string | null;
  shippingCost?: number; discountPct?: number; notes?: string | null; currencyCode?: string; exchangeRate?: number;
  items: { rfqItemId: string; available?: boolean; unitPrice?: number | null; quantity?: number | null; note?: string | null }[];
};

export const RFQ_STATUS_LABELS: Record<RfqStatus, string> = {
  draft: 'Brouillon', sent: 'Envoyé', quoted: 'Devis reçus', awarded: 'Attribué', cancelled: 'Annulé', closed: 'Sans suite',
};

export const rfqApi = {
  list: (params: Record<string, string>): Promise<{ rows: Rfq[]; total: number; byStatus: Record<string, { count: number; overdue: number }> }> =>
    api.get('/rfqs', { params }).then(r => r.data.data),
  get: (id: string): Promise<Rfq> => api.get(`/rfqs/${id}`).then(r => r.data.data),
  create: (data: RfqInput): Promise<Rfq> => api.post('/rfqs', data).then(r => r.data.data),
  update: (id: string, data: Partial<RfqInput>): Promise<Rfq> => api.patch(`/rfqs/${id}`, data).then(r => r.data.data),
  send: (id: string): Promise<Rfq & { emailsQueued?: number }> => api.post(`/rfqs/${id}/send`).then(r => r.data.data),
  setStatus: (id: string, status: 'cancelled' | 'closed' | 'draft'): Promise<Rfq> => api.post(`/rfqs/${id}/status`, { status }).then(r => r.data.data),
  setSupplierStatus: (id: string, supplierId: string, status: 'invited' | 'declined' | 'no_response', note?: string): Promise<Rfq> =>
    api.post(`/rfqs/${id}/suppliers/${supplierId}/status`, { status, note }).then(r => r.data.data),
  saveQuotation: (id: string, data: QuotationInput): Promise<Rfq> => api.put(`/rfqs/${id}/quotations`, data).then(r => r.data.data),
  award: (id: string, quotationId: string, extra?: { expectedDeliveryDate?: string | null; notes?: string | null }): Promise<{ data: Rfq; purchaseOrder: { id: string; order_number: string } }> =>
    api.post(`/rfqs/${id}/award`, { quotationId, ...extra }).then(r => ({ data: r.data.data, purchaseOrder: r.data.purchaseOrder })),
};
