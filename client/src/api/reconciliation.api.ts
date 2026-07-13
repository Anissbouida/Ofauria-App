import api from './client';

// Module Rapprochement journalier (ISOLE, TEMPORAIRE).

export type ReconLine = {
  id: string;
  recon_day_id: string;
  product_key: string;
  sku: string | null;
  product_name: string;
  category: string | null;
  appro_qty: string;
  recu_qty: string;
  vendu_qty: string;
  invendu_qty: string;
  unit_price: string;
  ecart_qty: string;
  ecart_value: string;
  source_vendu: 'manual' | 'loyverse_import';
};

export type ReconDay = {
  id: string;
  business_date: string;
  store_id: string | null;
  status: 'open' | 'closed';
  notes: string | null;
  lines: ReconLine[];
};

export type ReconDaySummary = {
  id: string;
  business_date: string;
  status: 'open' | 'closed';
  line_count: string;
  total_ecart_value: string;
};

export type ReconReportRow = {
  product_key: string;
  product_name: string;
  category: string | null;
  appro_qty: string;
  vendu_qty: string;
  invendu_qty: string;
  ecart_qty: string;
  ecart_value: string;
  days_count: string;
};

export type SuggestProduct = {
  product_key: string;
  product_name: string;
  sku: string | null;
  category: string | null;
  unit_price: string;
  suggested_qty: string;
  ref_appro: string | null;
  ref_vendu: string | null;
  ref_invendu: string | null;
};

export type SuggestResult = {
  referenceDate: string | null;
  products: SuggestProduct[];
};

export type SupplySlot = {
  id: string;
  category: string;
  slot_number: number;
  label: string;
  target_time: string | null;
  default_pct: number;
  sort_order: number;
};

export type DarijaEntry = {
  id: string;
  product_key: string;
  darija: string;
};

export type ReconProduct = {
  id: string;
  product_key: string;
  sku: string | null;
  product_name: string;
  category: string | null;
  unit_price: string;
};

export const reconciliationApi = {
  listDays: (params?: { from?: string; to?: string }) =>
    api.get('/reconciliation/days', { params }).then(r => r.data.data as ReconDaySummary[]),
  getDay: (id: string) =>
    api.get(`/reconciliation/days/${id}`).then(r => r.data.data as ReconDay),
  openDay: (date: string) =>
    api.post('/reconciliation/days', { date }).then(r => r.data.data as ReconDay),
  close: (id: string, force = false) => api.post(`/reconciliation/days/${id}/close`, { force }).then(r => r.data.data),
  reopen: (id: string) => api.post(`/reconciliation/days/${id}/reopen`).then(r => r.data.data),

  upsertLine: (dayId: string, data: { productName: string; sku?: string; category?: string; approQty?: number; invenduQty?: number; unitPrice?: number }) =>
    api.post(`/reconciliation/days/${dayId}/lines`, data).then(r => r.data.data as ReconLine),
  bulkAppro: (dayId: string, rows: { sku?: string; productName: string; category?: string; approQty: number; unitPrice?: number }[]) =>
    api.post(`/reconciliation/days/${dayId}/bulk-appro`, { rows }).then(r => r.data.data as { upserted: number }),
  updateLine: (lineId: string, data: { approQty?: number; recuQty?: number; venduQty?: number; invenduQty?: number; unitPrice?: number }) =>
    api.put(`/reconciliation/lines/${lineId}`, data).then(r => r.data.data as ReconLine),
  deleteLine: (lineId: string) => api.delete(`/reconciliation/lines/${lineId}`).then(r => r.data),

  importSales: (dayId: string, items: { sku?: string; productName: string; category?: string; quantity: number; unitPrice: number }[]) =>
    api.post(`/reconciliation/days/${dayId}/import-sales`, { items }).then(r => r.data.data as { upserted: number }),

  suggest: (date: string) =>
    api.get('/reconciliation/suggest', { params: { date } }).then(r => r.data.data as SuggestResult),

  listSlots: () =>
    api.get('/reconciliation/slots').then(r => r.data.data as SupplySlot[]),
  upsertSlot: (data: Partial<SupplySlot> & { category: string; label: string }) =>
    api.post('/reconciliation/slots', data).then(r => r.data.data as SupplySlot),
  deleteSlot: (id: string) =>
    api.delete(`/reconciliation/slots/${id}`).then(r => r.data),

  listProducts: () =>
    api.get('/reconciliation/products').then(r => r.data.data as ReconProduct[]),
  upsertProduct: (data: { id?: string; productName: string; sku?: string; category?: string; unitPrice?: number }) =>
    api.post('/reconciliation/products', data).then(r => r.data.data as ReconProduct),
  bulkProducts: (rows: { sku?: string; productName: string; category?: string; unitPrice?: number }[]) =>
    api.post('/reconciliation/products/bulk', { rows }).then(r => r.data.data as { upserted: number }),
  deleteProduct: (id: string) =>
    api.delete(`/reconciliation/products/${id}`).then(r => r.data),

  listDarija: () =>
    api.get('/reconciliation/darija').then(r => r.data.data as DarijaEntry[]),
  upsertDarija: (productKey: string, darija: string) =>
    api.post('/reconciliation/darija', { productKey, darija }).then(r => r.data.data as DarijaEntry | null),

  report: (params: { from: string; to: string }) =>
    api.get('/reconciliation/report', { params }).then(r => r.data.data as ReconReportRow[]),
};
