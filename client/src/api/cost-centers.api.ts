import api from './client';

/** Section analytique (centre de coût) d'un axe — mig 386 / 428. */
export interface CostCenter { id: string; code: string; name: string; is_active: boolean; invoices_count: number; axis_id: string; axis_code: string; axis_name: string }
export interface AssignableInvoice {
  id: string; invoice_number: string; invoice_type: 'received' | 'emitted'; invoice_date: string;
  amount: number; cost_center_id: string | null; party: string | null;
}
export interface AnalyticAxis { id: string; code: string; name: string; is_active: boolean; sections: number }
export interface AnalyticKey { id: string; axis_id: string; name: string; lines: { cost_center_id: string; code: string; name: string; percent: string }[] }
export interface VentilationLine {
  id: string; debit: string; credit: string; label: string; entry_number: string; entry_date: string; source_kind: string;
  account_code: string; account_label: string;
  ventilation: { cost_center_id: string; code: string; amount: string; source: 'manual' | 'key' | 'invoice' }[];
}
type Block = { produits: number; charges: number; result: number; accounts: { code: string; label: string; produits: number; charges: number }[] };
export interface AnalyticBalance {
  axis: { id: string; code: string; name: string }; from: string; to: string;
  sections: (Block & { id: string; code: string; name: string; is_active: boolean })[];
  unventilated: Block;
  totals: { produits: number; charges: number; result: number };
  ventilated_rate: number;
}
export interface AnalyticLine { entry_date: string; entry_number: string; account_code: string; account_label: string; label: string; amount: number; source: string | null }

export const costCentersApi = {
  list: (): Promise<CostCenter[]> => api.get('/cost-centers').then(r => r.data.data),
  create: (data: { code: string; name: string; axisId?: string }): Promise<CostCenter> => api.post('/cost-centers', data).then(r => r.data.data),
  setActive: (id: string, active: boolean) => api.post(`/cost-centers/${id}/active`, { active }).then(r => r.data.data),
  invoices: (params: { kind?: 'received' | 'emitted'; onlyUnassigned?: boolean; from?: string; to?: string }): Promise<AssignableInvoice[]> =>
    api.get('/cost-centers/invoices', { params }).then(r => r.data.data),
  assign: (invoiceId: string, costCenterId: string | null) => api.post('/cost-centers/assign', { invoiceId, costCenterId }).then(r => r.data),
};

/** Analytique sur les lignes d'écriture (mig 428). */
export const analyticApi = {
  axes: (): Promise<AnalyticAxis[]> => api.get('/cost-centers/axes').then(r => r.data.data),
  createAxis: (b: { code: string; name: string }): Promise<AnalyticAxis> => api.post('/cost-centers/axes', b).then(r => r.data.data),
  keys: (axisId: string): Promise<AnalyticKey[]> => api.get('/cost-centers/keys', { params: { axisId } }).then(r => r.data.data),
  createKey: (b: { axisId: string; name: string; lines: { costCenterId: string; percent: number }[] }) => api.post('/cost-centers/keys', b).then(r => r.data.data),
  deleteKey: (id: string) => api.delete(`/cost-centers/keys/${id}`).then(r => r.data.data),
  lines: (p: { axisId: string; from: string; to: string; status: 'open' | 'done' | 'all'; search?: string; accountClass?: 6 | 7 }): Promise<VentilationLine[]> =>
    api.get('/cost-centers/ventilation/lines', { params: p }).then(r => r.data.data),
  ventilate: (b: { lineIds: string[]; axisId: string; costCenterId?: string | null; keyId?: string | null }): Promise<{ lines: number }> =>
    api.post('/cost-centers/ventilation', b).then(r => r.data.data),
  clear: (b: { lineIds: string[]; axisId: string }): Promise<{ removed: number }> => api.post('/cost-centers/ventilation/clear', b).then(r => r.data.data),
  balance: (p: { axisId: string; from: string; to: string }): Promise<AnalyticBalance> => api.get('/cost-centers/balance', { params: p }).then(r => r.data.data),
  sectionLines: (p: { axisId: string; from: string; to: string; costCenterId?: string }): Promise<AnalyticLine[]> =>
    api.get('/cost-centers/balance/lines', { params: p }).then(r => r.data.data),
};
