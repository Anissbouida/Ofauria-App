import api from './client';

/** Phase 11 (D5-12) — ristournes de fin d'année (RFA). */
export interface RebateAgreement {
  id: string; customer_id: string; year: number;
  rate_percent: string; min_turnover: string;
  status: 'active' | 'settled' | 'cancelled';
  computed_turnover: string | null; computed_amount: string | null; settled_at: string | null;
  settled_credit_note_id: string | null;
  company_name: string | null; first_name: string | null; last_name: string | null;
  current_turnover: number; current_amount: number; eligible: boolean;
}

export const rebatesApi = {
  list: (year?: number): Promise<RebateAgreement[]> =>
    api.get('/rebates', { params: year ? { year } : {} }).then(r => r.data.data),
  create: (data: { customerId: string; year: number; ratePercent: number; minTurnover?: number }) =>
    api.post('/rebates', data).then(r => r.data.data),
  settle: (id: string) => api.put(`/rebates/${id}/settle`).then(r => r.data.data),
  cancel: (id: string) => api.put(`/rebates/${id}/cancel`).then(r => r.data),
};
