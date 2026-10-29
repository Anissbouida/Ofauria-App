import api from './client';

export interface CostCenter { id: string; code: string; name: string; is_active: boolean; invoices_count: number }
export interface CostCenterReportRow { id: string; code: string; name: string; charges: number; produits: number; result: number }
export interface CostCenterReport {
  from: string; to: string; rows: CostCenterReportRow[];
  unassigned: { charges: number; produits: number; result: number };
}
export interface AssignableInvoice {
  id: string; invoice_number: string; invoice_type: 'received' | 'emitted'; invoice_date: string;
  amount: number; cost_center_id: string | null; party: string | null;
}

export const costCentersApi = {
  list: (): Promise<CostCenter[]> => api.get('/cost-centers').then(r => r.data.data),
  create: (data: { code: string; name: string }): Promise<CostCenter> => api.post('/cost-centers', data).then(r => r.data.data),
  setActive: (id: string, active: boolean) => api.post(`/cost-centers/${id}/active`, { active }).then(r => r.data.data),
  report: (params: { from: string; to: string }): Promise<CostCenterReport> => api.get('/cost-centers/report', { params }).then(r => r.data.data),
  invoices: (params: { kind?: 'received' | 'emitted'; onlyUnassigned?: boolean; from?: string; to?: string }): Promise<AssignableInvoice[]> =>
    api.get('/cost-centers/invoices', { params }).then(r => r.data.data),
  assign: (invoiceId: string, costCenterId: string | null) => api.post('/cost-centers/assign', { invoiceId, costCenterId }).then(r => r.data),
};
