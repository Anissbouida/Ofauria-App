import api from './client';

// Module Rapprochement journalier (ISOLE, TEMPORAIRE).

export type ReconLine = {
  /** null sur les lignes agrégées de la vue Journée (day.lines). */
  id: string | null;
  recon_day_id: string;
  recon_shift_id: string | null;
  product_key: string;
  sku: string | null;
  product_name: string;
  category: string | null;
  /** Stock d'ouverture du shift (lecture seule, calculé serveur) :
   *  reste de J-1 pour le 1er shift, comptage de passation ensuite. */
  report_veille_qty: string | number;
  appro_qty: string | number;
  recu_qty: string | number;
  vendu_qty: string | number;
  vendu_amount: string | number;
  invendu_qty: string | number;
  unit_price: string | number;
  ecart_qty: string | number;
  ecart_value: string | number;
  source_vendu: 'manual' | 'loyverse_import';
};

/** Shift d'une journée (mig 262). shift_number 0 = journée entière (historique). */
export type ReconShift = {
  id: string;
  recon_day_id: string;
  shift_number: number;
  label: string;
  status: 'open' | 'closed';
  lines: ReconLine[];
};

export type ReconDay = {
  id: string;
  business_date: string;
  store_id: string | null;
  status: 'open' | 'closed';
  notes: string | null;
  shifts: ReconShift[];
  /** Vue agrégée de la journée (sommes des shifts ; ouverture = 1er shift, reste soir = dernier). */
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

export type ReconFicheLine = {
  product_key: string;
  sku: string | null;
  product_name: string;
  category: string | null;
  unit_price: string;
  slot_qty: Record<string, number>;
  total_qty: string;
  removed: boolean;
};

export type ReconFiche = {
  savedAt: string | null;
  savedBy: string | null;
  lines: ReconFicheLine[];
};

export type ReconFicheLineInput = {
  productName: string;
  sku?: string;
  category?: string;
  unitPrice?: number;
  slotQty?: Record<string, number>;
  totalQty?: number;
  removed?: boolean;
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

/** Catégorie dont le reste du soir se reporte en stock d'ouverture le lendemain. */
export type CarryOverCategory = {
  category: string;
  enabled: boolean;
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

  closeShift: (shiftId: string, force = false) =>
    api.post(`/reconciliation/shifts/${shiftId}/close`, { force }).then(r => r.data.data as ReconShift),
  reopenShift: (shiftId: string) =>
    api.post(`/reconciliation/shifts/${shiftId}/reopen`).then(r => r.data.data as ReconShift),

  upsertLine: (shiftId: string, data: { productName: string; sku?: string; category?: string; approQty?: number; recuQty?: number; invenduQty?: number; unitPrice?: number }) =>
    api.post(`/reconciliation/shifts/${shiftId}/lines`, data).then(r => r.data.data as ReconLine),
  bulkAppro: (shiftId: string, rows: { sku?: string; productName: string; category?: string; approQty: number; unitPrice?: number }[]) =>
    api.post(`/reconciliation/shifts/${shiftId}/bulk-appro`, { rows }).then(r => r.data.data as { upserted: number }),
  updateLine: (lineId: string, data: { approQty?: number; recuQty?: number; venduQty?: number; invenduQty?: number; unitPrice?: number }) =>
    api.put(`/reconciliation/lines/${lineId}`, data).then(r => r.data.data as ReconLine),
  deleteLine: (lineId: string) => api.delete(`/reconciliation/lines/${lineId}`).then(r => r.data),

  importSales: (shiftId: string, items: { sku?: string; productName: string; category?: string; quantity: number; unitPrice: number; netSales?: number }[]) =>
    api.post(`/reconciliation/shifts/${shiftId}/import-sales`, { items }).then(r => r.data.data as { upserted: number }),
  resetSales: (shiftId: string) =>
    api.post(`/reconciliation/shifts/${shiftId}/reset-sales`).then(r => r.data.data as { reset: number }),

  /** Télécharge le classeur xlsx détaillé de la journée (déclenche un download). */
  exportDayXlsx: async (dayId: string, businessDate: string) => {
    const resp = await api.get(`/reconciliation/days/${dayId}/export.xlsx`, { responseType: 'blob' });
    const url = URL.createObjectURL(resp.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `journee-${String(businessDate).slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  suggest: (date: string) =>
    api.get('/reconciliation/suggest', { params: { date } }).then(r => r.data.data as SuggestResult),

  getFiche: (date: string) =>
    api.get('/reconciliation/fiche', { params: { date } }).then(r => r.data.data as ReconFiche),
  saveFiche: (date: string, lines: ReconFicheLineInput[]) =>
    api.put('/reconciliation/fiche', { date, lines }).then(r => r.data.data as { saved: number }),

  listSlots: () =>
    api.get('/reconciliation/slots').then(r => r.data.data as SupplySlot[]),
  upsertSlot: (data: Partial<SupplySlot> & { category: string; label: string }) =>
    api.post('/reconciliation/slots', data).then(r => r.data.data as SupplySlot),
  deleteSlot: (id: string) =>
    api.delete(`/reconciliation/slots/${id}`).then(r => r.data),

  listCarryOver: () =>
    api.get('/reconciliation/carryover').then(r => r.data.data as CarryOverCategory[]),
  setCarryOver: (category: string, enabled: boolean) =>
    api.put('/reconciliation/carryover', { category, enabled }).then(r => r.data.data as CarryOverCategory),

  listProducts: () =>
    api.get('/reconciliation/products').then(r => r.data.data as ReconProduct[]),
  upsertProduct: (data: { id?: string; productName: string; sku?: string; category?: string; unitPrice?: number }) =>
    api.post('/reconciliation/products', data).then(r => r.data.data as ReconProduct),
  bulkProducts: (rows: { sku?: string; productName: string; category?: string; unitPrice?: number }[]) =>
    api.post('/reconciliation/products/bulk', { rows }).then(r => r.data.data as { upserted: number }),
  deleteProduct: (id: string) =>
    api.delete(`/reconciliation/products/${id}`).then(r => r.data),
  clearProducts: () =>
    api.delete(`/reconciliation/products`).then(r => r.data.data as { deleted: number }),

  listDarija: () =>
    api.get('/reconciliation/darija').then(r => r.data.data as DarijaEntry[]),
  upsertDarija: (productKey: string, darija: string) =>
    api.post('/reconciliation/darija', { productKey, darija }).then(r => r.data.data as DarijaEntry | null),

  report: (params: { from: string; to: string }) =>
    api.get('/reconciliation/report', { params }).then(r => r.data.data as ReconReportRow[]),
};
