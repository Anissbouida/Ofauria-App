import api from './client';

export const purchaseRequestsApi = {
  list: (params?: Record<string, string>) =>
    api.get('/purchase-requests', { params }).then(r => r.data.data),
  grouped: () =>
    api.get('/purchase-requests/grouped').then(r => r.data.data),
  count: () =>
    api.get('/purchase-requests/count').then(r => r.data.data),
  create: (data: {
    ingredientId: string;
    supplierId?: string | null;
    quantity: number;
    unit: string;
    reason?: string;
    note?: string;
  }) => api.post('/purchase-requests', data).then(r => r.data.data),
  updateQuantity: (id: string, quantity: number) =>
    api.put(`/purchase-requests/${id}/quantity`, { quantity }).then(r => r.data.data),
  assignSupplier: (id: string, supplierId: string | null) =>
    api.put(`/purchase-requests/${id}/supplier`, { supplierId }).then(r => r.data.data),
  bulkAssignSupplier: (requestIds: string[], supplierId: string | null) =>
    api.post(`/purchase-requests/bulk-assign-supplier`, { requestIds, supplierId }).then(r => r.data.data),
  /** Annulation d'une demande en attente : motif obligatoire (journalisé). */
  cancel: (id: string, reason: string) =>
    api.post(`/purchase-requests/${id}/cancel`, { reason }).then(r => r.data.data),
  /** Clôture du reliquat d'une demande commandée : on renonce au manquant. */
  close: (id: string, reason: string) =>
    api.post(`/purchase-requests/${id}/close`, { reason }).then(r => r.data.data),
  history: (id: string) =>
    api.get(`/purchase-requests/${id}/history`).then(r => r.data.data),
  /** Stock › À commander : besoins fusionnés par ingrédient (ruptures, demandes, stock bas). */
  toOrder: () =>
    api.get('/purchase-requests/to-order').then(r => r.data.data as { rows: ToOrderRow[] }),
  // Flux procure-to-pay (mig 457) : plus de génération de BC depuis une DA. Une DA
  // approuvée passe par un appel d'offres (rfqApi.createFromRequests) ; le BC naît
  // de l'attribution de l'AO.
};

export type ToOrderRow = {
  ingredient_id: string; ingredient_name: string; unit: string;
  rupture_qty: number; rupture_refs: string[];
  request_qty: number; request_ids: string[]; requesters: string[];
  low_stock: { current: number; threshold: number; suggested: number } | null;
  on_order_qty: number; on_order_refs: string[];
  suggested_qty: number; covered: boolean;
  supplier_id: string | null; last_supplier_id: string | null; last_supplier_name: string | null;
  unit_price: number | null; last_order_date: string | null; priority: 1 | 2 | 3;
};
