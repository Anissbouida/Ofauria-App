import api from './client';

// Listes de prix (phase 6.1–6.3).
export interface PriceList {
  id: string;
  name: string;
  currency: string;
  channel_id: string | null;
  channel_name?: string | null;
  customer_type: string | null;
  price_group: string | null;
  customer_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  priority: number;
  is_active: boolean;
  item_count?: number;
}
export interface PriceListItem {
  id: string;
  price_list_id: string;
  product_id: string;
  product_name?: string;
  min_quantity: number;
  unit_price: number;
}
export interface ResolvedPrice {
  unitPrice: number;
  priceListId: string;
  priceListName: string;
  currency: string;
}

export const pricingApi = {
  list: () => api.get('/pricing/lists').then(r => r.data.data as PriceList[]),
  get: (id: string) => api.get(`/pricing/lists/${id}`).then(r => r.data.data as PriceList & { items: PriceListItem[] }),
  create: (data: Record<string, any>) => api.post('/pricing/lists', data).then(r => r.data.data as PriceList),
  update: (id: string, data: Record<string, any>) => api.put(`/pricing/lists/${id}`, data).then(r => r.data.data as PriceList),
  remove: (id: string) => api.delete(`/pricing/lists/${id}`),
  setItem: (id: string, data: { productId: string; minQuantity?: number; unitPrice: number }) =>
    api.post(`/pricing/lists/${id}/items`, data).then(r => r.data.data as PriceListItem),
  removeItem: (id: string, itemId: string) => api.delete(`/pricing/lists/${id}/items/${itemId}`),
  /** Prix applicable (caisse, devis, commande, BL) ; null si aucune liste. */
  resolve: (params: { productId: string; quantity?: number; channelId?: string; customerId?: string }) =>
    api.get('/pricing/resolve', { params }).then(r => r.data.data as ResolvedPrice | null),
  /** Mise à jour en masse du prix catalogue (phase 6.5). */
  bulkUpdate: (data: { mode: 'increase_pct' | 'set'; value: number; reason: string; categoryId?: number; family?: string; productIds?: string[] }) =>
    api.post('/pricing/bulk-update', data).then(r => r.data.data as { count: number; batchId: string }),
  history: (productId?: string) => api.get('/pricing/history', { params: productId ? { productId } : {} }).then(r => r.data.data as PriceChange[]),
};

export interface PriceChange {
  id: string; product_id: string; product_name?: string;
  old_price: string | number | null; new_price: string | number | null; pct: string | number | null;
  reason: string | null; batch_id: string | null; first_name?: string | null; last_name?: string | null; changed_at: string;
}
