import api from './client';

// Transferts de produits finis entre sites (phase 7.4).
export interface ProductTransfer {
  id: string; number: string; from_store_id: string; to_store_id: string;
  from_store_name?: string; to_store_name?: string; status: string; transfer_date: string; notes: string | null; item_count?: number;
}

export const productTransfersApi = {
  list: (storeId?: string) => api.get('/product-transfers', { params: storeId ? { storeId } : {} }).then(r => r.data.data as ProductTransfer[]),
  get: (id: string) => api.get(`/product-transfers/${id}`).then(r => r.data.data),
  create: (data: { fromStoreId: string; toStoreId: string; items: { productId: string; quantity: number }[]; notes?: string; transferDate?: string }) =>
    api.post('/product-transfers', data).then(r => r.data.data as ProductTransfer),
};
