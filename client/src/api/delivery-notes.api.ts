import api from './client';

/** Ventes aux professionnels (mig 352) : bons de livraison clients et facturation groupée. */
export interface DeliveryNote {
  id: string; number: string; customer_id: string; customer_name: string; customer_type: string | null;
  order_id: string | null; order_number: string | null; delivery_date: string;
  status: 'delivered' | 'invoiced' | 'cancelled'; invoice_id: string | null; invoice_number: string | null;
  notes: string | null; created_by_name: string | null; created_at: string;
  total_ht: string; total_tva: string; total_ttc: string; line_count: string;
  items?: Array<{ id: string; product_id: string | null; product_name: string | null; description: string; quantity: string; unit_price: string; tva_rate: string | null; subtotal: string }>;
}
export interface ToInvoiceGroup {
  customerId: string; name: string; notes: DeliveryNote[]; totalHt: number; totalTtc: number; firstDate: string; lastDate: string;
}
export interface DeliveryLinePayload { productId?: string | null; description?: string | null; quantity: number; unitPrice: number; tvaRate?: number | null }

export const deliveryNotesApi = {
  list: (params?: Record<string, string>) => api.get('/delivery-notes', { params }).then(r => r.data.data as DeliveryNote[]),
  getById: (id: string) => api.get(`/delivery-notes/${id}`).then(r => r.data.data as DeliveryNote),
  lineDefaults: (customerId: string, productIds: string[]) =>
    api.get('/delivery-notes/line-defaults', { params: { customerId, productIds: productIds.join(',') } })
      .then(r => r.data.data as Record<string, { unitPrice: number; tvaRate: number | null }>),
  eligibleOrders: (customerId: string) => api.get(`/delivery-notes/orders/${customerId}`).then(r => r.data.data as Array<{ id: string; order_number: string; pickup_date: string | null; total: string; status: string }>),
  orderLines: (orderId: string) => api.get(`/delivery-notes/order-lines/${orderId}`).then(r => r.data.data as Array<{ product_id: string; description: string; quantity: string; unit_price: string }>),
  create: (data: { customerId: string; deliveryDate?: string; orderId?: string | null; notes?: string; items: DeliveryLinePayload[] }) =>
    api.post('/delivery-notes', data).then(r => r.data.data as DeliveryNote),
  /** Livrer une commande prête sur BL (module Commandes). */
  createFromOrder: (orderId: string) => api.post(`/delivery-notes/from-order/${orderId}`).then(r => r.data.data as DeliveryNote),
  cancel: (id: string) => api.post(`/delivery-notes/${id}/cancel`).then(r => r.data.data),
  toInvoice: (until?: string) => api.get('/delivery-notes/to-invoice', { params: until ? { until } : {} }).then(r => r.data.data as ToInvoiceGroup[]),
  invoice: (deliveryNoteIds: string[], invoiceDate?: string) =>
    api.post('/delivery-notes/invoice', { deliveryNoteIds, invoiceDate }).then(r => r.data.data as { id: string; invoice_number: string; total_amount: string }),
};
