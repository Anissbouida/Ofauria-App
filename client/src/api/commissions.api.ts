import api from './client';

/** Commissions commerciales (barèmes mig 123 + relevé). */
export type CommissionRule = {
  id: string; employee_id: string; employee_name: string; rate_percent: string;
  applies_to: 'all' | 'product' | 'category'; applies_id: string | null; product_name: string | null;
  valid_from: string; valid_to: string | null; is_current: boolean;
};
export type CommissionRuleInput = {
  employeeId: string; ratePercent: number; appliesTo: 'all' | 'product'; appliesId?: string | null;
  validFrom: string; validTo?: string | null;
};
export type CommissionStatementRow = {
  employee_id: string; employee_name: string; role: string | null;
  sale_count: number; sales_base: number; commissionable_base: number; commission: number;
};
export type CommissionStatement = { rows: CommissionStatementRow[]; totals: { sales_base: number; commission: number } };

export const commissionsApi = {
  listRules: (employeeId?: string): Promise<CommissionRule[]> =>
    api.get('/commissions/rules', { params: employeeId ? { employeeId } : {} }).then(r => r.data.data),
  createRule: (data: CommissionRuleInput) => api.post('/commissions/rules', data).then(r => r.data.data),
  updateRule: (id: string, data: CommissionRuleInput) => api.put(`/commissions/rules/${id}`, data).then(r => r.data.data),
  deleteRule: (id: string) => api.delete(`/commissions/rules/${id}`).then(r => r.data.data),
  statement: (params: { from: string; to: string; employeeId?: string }): Promise<CommissionStatement> =>
    api.get('/commissions/statement', { params }).then(r => r.data.data),
};
