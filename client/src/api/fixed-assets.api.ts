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
};
