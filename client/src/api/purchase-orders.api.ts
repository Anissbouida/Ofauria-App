import api from './client';

/** Une clé par soumission de formulaire : un double clic ou une reprise réseau ne crée pas deux documents (mig 307). */
export const newIdempotencyKey = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

export const purchaseOrdersApi = {
  list: (params?: Record<string, string>) =>
    api.get('/purchase-orders', { params }).then(r => r.data.data),
  /** Écran BC : page de la liste par étape (view=open) ou par période (view=history). */
  board: (params: Record<string, string>) =>
    api.get('/purchase-orders/board', { params }).then(r => r.data.data as { rows: Record<string, any>[]; total: number; page: number; pageSize: number }),
  /** Compteurs par étape du processus + BC en retard. */
  pipeline: () =>
    api.get('/purchase-orders/pipeline').then(r => r.data.data as {
      stages: { stage: string; count: number; amount: string; late_count: number }[];
      late: { id: string; order_number: string; supplier_name: string; expected_delivery_date: string; stage: string; days_late: number }[];
    }),
  getById: (id: string) =>
    api.get(`/purchase-orders/${id}`).then(r => r.data.data),
  create: (data: Record<string, any>, idempotencyKey: string = newIdempotencyKey()) =>
    api.post('/purchase-orders', data, { headers: { 'Idempotency-Key': idempotencyKey } }).then(r => r.data.data),
  /** 200 = envoyé ; 202 = soumis à approbation (r.approval décrit la demande, lot 8). */
  send: (id: string) =>
    api.post(`/purchase-orders/${id}/send`).then(r => r.data as { success: boolean; data: Record<string, unknown>; approval?: { rule_label: string; steps?: { approver_name?: string | null; approver_role?: string | null }[] } }),
  confirmDelivery: (id: string, data: { items: { itemId: string; quantityDelivered: number; unitPrice?: number | null; supplierLotNumber?: string; expirationDate?: string; manufacturedDate?: string }[]; supplierInvoiceNumber?: string; supplierInvoiceDate?: string; forceComplete?: boolean }, idempotencyKey: string = newIdempotencyKey()) =>
    api.post(`/purchase-orders/${id}/confirm-delivery`, data, { headers: { 'Idempotency-Key': idempotencyKey } }).then(r => r.data.data),
  /** Motif codé obligatoire (référentiel purchase_reason_codes, mig 306). */
  markNotDelivered: (id: string, reason: { reasonCodeId: string; note?: string }) =>
    api.post(`/purchase-orders/${id}/not-delivered`, reason).then(r => r.data.data),
  cancel: (id: string, reason: { reasonCodeId: string; note?: string }) =>
    api.post(`/purchase-orders/${id}/cancel`, reason).then(r => r.data.data),
  /** Blocage : ni réception ni facture tant qu'il n'est pas levé. */
  hold: (id: string, reason: { reasonCodeId: string; note?: string }) =>
    api.post(`/purchase-orders/${id}/hold`, reason).then(r => r.data.data),
  release: (id: string, note?: string) =>
    api.post(`/purchase-orders/${id}/release`, { note }).then(r => r.data.data),
  /** Gel (admin) : en-tête et lignes figés quel que soit le statut. */
  freeze: (id: string, note?: string) =>
    api.post(`/purchase-orders/${id}/freeze`, { note }).then(r => r.data.data),
  unfreeze: (id: string, note?: string) =>
    api.post(`/purchase-orders/${id}/unfreeze`, { note }).then(r => r.data.data),
  actions: (id: string) =>
    api.get(`/purchase-orders/${id}/actions`).then(r => r.data.data),
  /** Clôture du reliquat (toutes les lignes, ou une ligne) : motif obligatoire (mig 307). */
  closeRemainder: (id: string, reason: { reasonCodeId: string; note?: string }, lineId?: string) =>
    api.post(lineId ? `/purchase-orders/${id}/lines/${lineId}/close-remainder` : `/purchase-orders/${id}/close-remainder`, reason).then(r => r.data.data),
  reopenRemainder: (id: string, lineId: string, note?: string) =>
    api.post(`/purchase-orders/${id}/lines/${lineId}/reopen`, { note }).then(r => r.data.data),
  /** Avenant motivé sur un BC engagé : crée une version numérotée. */
  changeOrder: (id: string, data: {
    reasonCodeId: string; note?: string;
    header?: { expectedDeliveryDate?: string | null; notes?: string | null };
    lines?: Array<{ id: string; qtyContainer?: number; unitPrice?: number | null; discountPct?: number; tvaRate?: number | null }>;
  }, idempotencyKey: string = newIdempotencyKey()) =>
    api.post(`/purchase-orders/${id}/change-orders`, data, { headers: { 'Idempotency-Key': idempotencyKey } }).then(r => r.data.data),
  versions: (id: string) =>
    api.get(`/purchase-orders/${id}/versions`).then(r => r.data.data),
  /** Annule la reception d'un BC (reverse stock + facture + compta). Admin uniquement. */
  cancelReception: (id: string, reason: { reasonCodeId: string; note?: string }) =>
    api.post(`/purchase-orders/${id}/cancel-reception`, reason).then(r => r.data.data),
  /** Correction d'une ligne de réception (+/− en unité de base), motif obligatoire (mig 308). */
  correctReceipt: (id: string, lineId: string, data: { delta: number; reasonCodeId: string; note?: string }) =>
    api.post(`/purchase-orders/${id}/lines/${lineId}/correct-receipt`, data).then(r => r.data.data),
  updatePrices: (id: string, data: { items: { itemId: string; unitPrice: number }[] }) =>
    api.post(`/purchase-orders/${id}/update-prices`, data).then(r => r.data.data),
  /** Genere manuellement la facture d'un BC livre dont la facture auto n'a pas ete creee. */
  generateInvoice: (id: string) =>
    api.post(`/purchase-orders/${id}/invoice`).then(r => r.data.data),
  /** Edition en-tete (admin/gerant) : fournisseur, date prevue, notes. */
  updateHeader: (id: string, data: { supplierId?: string; expectedDeliveryDate?: string | null; notes?: string | null }) =>
    api.put(`/purchase-orders/${id}`, data).then(r => r.data.data),
  /** Remplace toutes les lignes (admin/gerant). Bulk save : voir backend replaceItems. */
  replaceItems: (id: string, items: Array<{
    id?: string;
    ingredientId?: string | null;
    packagingId?: string | null;
    quantityOrdered: number;
    quantityDelivered?: number;
    unitPrice?: number | null;
  }>) => api.put(`/purchase-orders/${id}/items`, { items }).then(r => r.data.data),
  downloadPdf: (id: string) =>
    api.get(`/purchase-orders/${id}/download-pdf`, { responseType: 'blob' }).then(r => r),
  remove: (id: string) =>
    api.delete(`/purchase-orders/${id}`),
  eligible: () =>
    api.get('/purchase-orders/eligible').then(r => r.data.data),
  overdue: (days?: number) =>
    api.get('/purchase-orders/overdue', { params: days ? { days: String(days) } : undefined }).then(r => r.data.data),
};

export const receptionVouchersApi = {
  list: (params?: Record<string, string>) =>
    api.get('/reception-vouchers', { params }).then(r => r.data.data),
  getById: (id: string) =>
    api.get(`/reception-vouchers/${id}`).then(r => r.data.data),
  create: (data: Record<string, any>) =>
    api.post('/reception-vouchers', data).then(r => r.data.data),
  findByPurchaseOrder: (poId: string) =>
    api.get(`/reception-vouchers/purchase-order/${poId}`).then(r => r.data.data),
};
