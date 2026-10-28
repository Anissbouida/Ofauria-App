import api from './client';

/** Tickets en attente à la caisse (mig 373). */
export type ParkedItem = { productId: string; name: string; price: number; quantity: number; unit: 'unit' | 'g' | 'person'; displayUnit?: 'g' | 'kg' | null; imageUrl?: string | null };
export type ParkedTicket = {
  id: string; store_id: string; user_id: string; user_name: string; customer_id: string | null; customer_label: string | null; label: string | null;
  channel_id: string | null; coupon_code: string | null; sachets_given: number | null; items: ParkedItem[]; item_count: number; total: string; created_at: string;
};
export type ParkedInput = {
  items: ParkedItem[]; customerId?: string | null; customerLabel?: string | null; label?: string | null;
  channelId?: string | null; couponCode?: string | null; sachetsGiven?: number | null; total: number;
};

export const posParkedApi = {
  list: (): Promise<ParkedTicket[]> => api.get('/pos/parked').then(r => r.data.data),
  park: (d: ParkedInput): Promise<ParkedTicket> => api.post('/pos/parked', d).then(r => r.data.data),
  take: (id: string): Promise<ParkedTicket> => api.delete(`/pos/parked/${id}`).then(r => r.data.data),
};
