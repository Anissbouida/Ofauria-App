import api from './client';

// Retours clients professionnels (phase 7.5).
export interface ProReturn {
  id: string; number: string; customer_id: string; customer_name?: string; delivery_note_id: string | null;
  status: string; return_date: string; credit_note_id: string | null; item_count?: number;
}

export const proReturnsApi = {
  list: (customerId?: string) => api.get('/pro-returns', { params: customerId ? { customerId } : {} }).then(r => r.data.data as ProReturn[]),
  get: (id: string) => api.get(`/pro-returns/${id}`).then(r => r.data.data),
  create: (data: { customerId: string; deliveryNoteId?: string | null; storeId?: string; notes?: string; creditedInvoiceId?: string;
    items: { productId: string; productLotId?: string | null; deliveryNoteItemId?: string | null; quantity: number; unitPrice?: number; decision: 'restock' | 'scrap' }[] }) =>
    api.post('/pro-returns', data).then(r => r.data.data as ProReturn),
};
