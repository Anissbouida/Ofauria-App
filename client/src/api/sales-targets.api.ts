import api from './client';

/** Phase 11 (D3-13) — objectifs par commercial. */
export interface TargetRow {
  salespersonId: string; name: string; targetId: string | null;
  target: number; realized: number; gap: number; pct: number | null;
}
export interface Salesperson { id: string; first_name: string | null; last_name: string | null }

export const salesTargetsApi = {
  report: (periodStart: string, periodEnd: string): Promise<TargetRow[]> =>
    api.get('/sales-targets', { params: { periodStart, periodEnd } }).then(r => r.data.data),
  salespeople: (): Promise<Salesperson[]> => api.get('/sales-targets/salespeople').then(r => r.data.data),
  upsert: (data: { salespersonId: string; periodStart: string; periodEnd: string; targetAmount: number }) =>
    api.post('/sales-targets', data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/sales-targets/${id}`).then(r => r.data),
};
