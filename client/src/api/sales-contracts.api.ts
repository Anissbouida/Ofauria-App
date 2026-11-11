import api from './client';

/** Phase 11 (D3-37) — contrats-cadres / commandes ouvertes. */
export interface SalesContract {
  id: string; number: string; customer_id: string;
  basis: 'quantity' | 'value';
  product_id: string | null; product_name: string | null;
  company_name: string | null; first_name: string | null; last_name: string | null;
  committed_quantity: string | null; committed_value: string | null; unit_price: string | null;
  start_date: string; end_date: string | null; status: 'active' | 'closed'; notes: string | null;
  consumed: number; committed: number; remaining: number;
  releases?: { id: string; order_number: string; total: string; status: string; created_at: string }[];
}

export interface CreateContractInput {
  customerId: string; basis: 'quantity' | 'value';
  productId?: string | null; committedQuantity?: number | null; committedValue?: number | null;
  unitPrice?: number | null; startDate: string; endDate?: string | null; notes?: string | null;
}

export const salesContractsApi = {
  list: (customerId?: string): Promise<SalesContract[]> =>
    api.get('/sales-contracts', { params: customerId ? { customerId } : {} }).then(r => r.data.data),
  get: (id: string): Promise<SalesContract> => api.get(`/sales-contracts/${id}`).then(r => r.data.data),
  create: (data: CreateContractInput): Promise<SalesContract> => api.post('/sales-contracts', data).then(r => r.data.data),
  addRelease: (id: string, orderId: string) => api.post(`/sales-contracts/${id}/releases`, { orderId }).then(r => r.data.data),
  close: (id: string) => api.put(`/sales-contracts/${id}/close`).then(r => r.data),
};
