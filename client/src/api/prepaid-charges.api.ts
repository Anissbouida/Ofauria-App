import api from './client';

export interface PrepaidChargeListItem {
  id: string;
  label: string;
  charge_account_code: string;
  charge_account_label: string;
  total_amount: number;
  start_date: string;
  end_date: string;
  months: number;
  status: 'active' | 'done' | 'cancelled';
  recognized: number;
  recognized_months: number;
  remaining: number;
}

export interface PrepaidChargeDetail extends PrepaidChargeListItem {
  schedule: { month: string; amount: number; recognized: boolean }[];
  recognitions: { period_month: string; amount: number; journal_entry_id: string; recognized_at: string }[];
}

export const prepaidChargesApi = {
  list: (): Promise<PrepaidChargeListItem[]> => api.get('/prepaid-charges').then(r => r.data.data),
  getById: (id: string): Promise<PrepaidChargeDetail> => api.get(`/prepaid-charges/${id}`).then(r => r.data.data),
  create: (data: { label: string; chargeAccountCode: string; totalAmount: number; startDate: string; endDate: string; notes?: string }) =>
    api.post('/prepaid-charges', data).then(r => r.data.data),
  /** Constate les mois échus (jusqu'à asOf, défaut aujourd'hui) d'une CCA ou de toutes. */
  recognize: (data: { id?: string; asOf?: string }): Promise<{ posted: number }> =>
    api.post('/prepaid-charges/recognize', data).then(r => r.data.data),
};
