import api from './client';

export interface FixedAsset {
  id: string;
  label: string;
  asset_account_id: string;
  depreciation_account_id: string;
  expense_account_id: string;
  asset_account_code: string;
  asset_account_label: string;
  depreciation_account_code: string;
  expense_account_code: string;
  acquisition_date: string;
  acquisition_cost: string;
  residual_value: string;
  duration_years: number;
  method: 'linear' | 'degressive';
  status: 'active' | 'disposed' | 'fully_depreciated';
  supplier_name: string | null;
  total_depreciated: string;
  notes: string | null;
  // Sortie (mig 427)
  disposal_date: string | null;
  disposal_kind: 'sale' | 'scrap' | null;
  disposal_price: string | null;
  disposal_cumulated: string | null;
  disposal_vnc: string | null;
  disposal_gain: string | null;
  disposal_buyer: string | null;
}

export interface DisposalInput {
  date: string; kind: 'sale' | 'scrap'; price?: number; vatRate?: number;
  counterpart?: 'receivable' | 'bank' | 'cash'; buyer?: string | null; reason?: string | null;
}
export interface DisposalPreview { cost: number; complementary: number; months: number; cumulated: number; vnc: number; price: number; gain: number }
export type AssetTableAmounts = { gross_start: number; acquisitions: number; disposals: number; gross_end: number; dep_start: number; dep_year: number; dep_out: number; dep_end: number; vnc_end: number };
export interface AssetsTable {
  year: number;
  groups: { account_code: string; account_label: string; totals: AssetTableAmounts; items: (AssetTableAmounts & { id: string; label: string; acquisition_date: string; status: string })[] }[];
  totals: AssetTableAmounts;
  disposals: { id: string; label: string; account_code: string; cost: number; date: string; kind: 'sale' | 'scrap'; price: number; cumulated: number; vnc: number; gain: number }[];
  gain_total: number;
}

export interface ScheduleLine {
  year: number;
  month: number;
  amount: number;
  cumulated: number;
  vnc: number;
  posted: boolean;
}

export interface AssetSchedule {
  asset: FixedAsset;
  schedule: ScheduleLine[];
}

export interface RunDepreciationResult {
  created: number;
  skipped: number;
  totalAmount: number;
}

export const fixedAssetsApi = {
  list: (): Promise<FixedAsset[]> =>
    api.get('/fixed-assets').then(r => r.data.data),
  schedule: (id: string): Promise<AssetSchedule> =>
    api.get(`/fixed-assets/${id}/schedule`).then(r => r.data.data),
  create: (data: Record<string, unknown>): Promise<FixedAsset> =>
    api.post('/fixed-assets', data).then(r => r.data.data),
  remove: (id: string): Promise<void> =>
    api.delete(`/fixed-assets/${id}`).then(() => undefined),
  runDepreciation: (year: number, month: number): Promise<RunDepreciationResult> =>
    api.post('/fixed-assets/run-depreciation', { year, month }).then(r => r.data.data),
  previewDisposal: (id: string, b: DisposalInput): Promise<DisposalPreview> =>
    api.post(`/fixed-assets/${id}/disposal/preview`, b).then(r => r.data.data),
  dispose: (id: string, b: DisposalInput): Promise<DisposalPreview & { entry_number: string; vat: number }> =>
    api.post(`/fixed-assets/${id}/dispose`, b).then(r => r.data.data),
  cancelDisposal: (id: string, reason: string): Promise<{ status: string }> =>
    api.post(`/fixed-assets/${id}/cancel-disposal`, { reason }).then(r => r.data.data),
  table: (year: number): Promise<AssetsTable> =>
    api.get('/fixed-assets/table', { params: { year } }).then(r => r.data.data),
};
