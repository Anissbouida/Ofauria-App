import api from './client';

/** Évaluation des fournisseurs (mig 362). */
export type Standing = 'A' | 'B' | 'C' | 'D' | 'new';
export type Rate = { ok: number; total: number; rate: number | null };
export type SupplierMetrics = {
  supplier_id: string; supplier_name: string; orders: number;
  on_time: Rate & { avg_late_days: number | null };
  fill_rate: Rate; quality: Rate;
  price: Rate & { avg_increase_pct: number | null };
  disputes: { disputed: number; total: number; rate: number | null };
};
export type ScoreWeights = { on_time: number; fill_rate: number; quality: number; price: number; disputes: number; min_orders: number; months: number; a_min: number; b_min: number; c_min: number };
export type ScoreRow = SupplierMetrics & {
  score: number | null; standing: Standing; parts: Record<string, number | null>;
  previous_score: number | null; previous_standing: Standing | null; previous_period_to: string | null;
};
export type ScoreBoard = { rows: ScoreRow[]; weights: ScoreWeights; counts: Record<Standing, number>; from: string; to: string };
export type SupplierScoreDetail = {
  from: string; to: string; weights: ScoreWeights; metrics: SupplierMetrics | null;
  score: { score: number | null; standing: Standing; parts: Record<string, number | null> } | null;
  facts: {
    late: { order_number: string; expected_delivery_date: string; first_reception: string; late_days: number }[];
    nonconform: { voucher_number: string; reception_date: string; notes: string | null; temperature_ok: boolean | null; visual_ok: boolean | null; packaging_ok: boolean | null; labels_ok: boolean | null }[];
    increases: { voucher_number: string; reception_date: string; label: string; po_unit_price: string; unit_price: string; increase_pct: string }[];
    disputed: { invoice_number: string; invoice_date: string; total_amount: string; status: string; holds: string | null }[];
  };
  history: { id: string; period_from: string; period_to: string; score: string | null; standing: Standing; note: string | null; computed_at: string }[];
};

export const STANDING_LABELS: Record<Standing, string> = { A: 'A · Excellent', B: 'B · Bon', C: 'C · À surveiller', D: 'D · Problématique', new: 'Trop récent' };
export const STANDING_TAG: Record<Standing, string> = { A: 'odoo-tag-green', B: 'odoo-tag-blue', C: 'odoo-tag-orange', D: 'odoo-tag-red', new: 'odoo-tag-grey' };
export const CRITERIA: { key: 'on_time' | 'fill_rate' | 'quality' | 'price' | 'disputes'; label: string; hint: string }[] = [
  { key: 'on_time', label: 'Délais tenus', hint: 'réceptions à la date attendue du BC' },
  { key: 'fill_rate', label: 'Livraisons complètes', hint: 'BC livrés en totalité' },
  { key: 'quality', label: 'Conformité', hint: 'contrôles à réception conformes' },
  { key: 'price', label: 'Prix stables', hint: 'lignes reçues sans hausse sur le BC' },
  { key: 'disputes', label: 'Sans litige', hint: 'factures sans blocage ni litige' },
];

export const supplierScoreApi = {
  board: (params: Record<string, string> = {}): Promise<ScoreBoard> => api.get('/supplier-scores', { params }).then(r => r.data.data),
  latest: (): Promise<{ supplier_id: string; score: string | null; standing: Standing; period_to: string }[]> => api.get('/supplier-scores/latest').then(r => r.data.data),
  detail: (supplierId: string, params: Record<string, string> = {}): Promise<SupplierScoreDetail> => api.get(`/supplier-scores/${supplierId}`, { params }).then(r => r.data.data),
  snapshot: (data: { from?: string; to?: string; note?: string | null } = {}): Promise<{ from: string; to: string; count: number }> => api.post('/supplier-scores/snapshot', data).then(r => r.data.data),
};
