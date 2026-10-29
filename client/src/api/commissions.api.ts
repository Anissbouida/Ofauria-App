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
  sale_count: number; sales_base: number; commissionable_base: number;
  commission_rules: number; commission_scheme: number | null; commission: number;
  mode: 'rules' | 'scheme'; scheme_id: string | null; scheme_name: string | null; already_paid: boolean;
};
export type CommissionStatement = { rows: CommissionStatementRow[]; totals: { sales_base: number; commission: number } };

/** Contrat-cadre à paliers (mig 393). */
export type SchemeTier = { id?: string; from_amount: string | number; rate_percent: string | number };
export type CommissionScheme = {
  id: string; name: string; is_active: boolean; notes: string | null; assigned_count: number; tiers: SchemeTier[];
};
export type CommissionSchemeInput = { name: string; isActive?: boolean; notes?: string | null; tiers: { fromAmount: number; ratePercent: number }[] };
export type SchemeAssignment = {
  id: string; employee_id: string; employee_name: string; scheme_id: string; scheme_name: string;
  valid_from: string; valid_to: string | null; is_current: boolean;
};
export type CommissionPayout = {
  id: string; employee_id: string; employee_name: string; period_from: string; period_to: string;
  pay_month: number; pay_year: number; amount: string; basis: string; source: 'rules' | 'scheme'; created_at: string;
};
export type PayoutResult = {
  versed: { employee_id: string; employee_name: string; amount: number }[];
  skipped: { employee_id: string; employee_name: string }[];
  payMonth?: number; payYear?: number;
};

export const commissionsApi = {
  listRules: (employeeId?: string): Promise<CommissionRule[]> =>
    api.get('/commissions/rules', { params: employeeId ? { employeeId } : {} }).then(r => r.data.data),
  createRule: (data: CommissionRuleInput) => api.post('/commissions/rules', data).then(r => r.data.data),
  updateRule: (id: string, data: CommissionRuleInput) => api.put(`/commissions/rules/${id}`, data).then(r => r.data.data),
  deleteRule: (id: string) => api.delete(`/commissions/rules/${id}`).then(r => r.data.data),
  statement: (params: { from: string; to: string; employeeId?: string }): Promise<CommissionStatement> =>
    api.get('/commissions/statement', { params }).then(r => r.data.data),
  // Contrats-cadres à paliers
  listSchemes: (): Promise<CommissionScheme[]> => api.get('/commissions/schemes').then(r => r.data.data),
  createScheme: (data: CommissionSchemeInput) => api.post('/commissions/schemes', data).then(r => r.data.data),
  updateScheme: (id: string, data: CommissionSchemeInput) => api.put(`/commissions/schemes/${id}`, data).then(r => r.data.data),
  deleteScheme: (id: string) => api.delete(`/commissions/schemes/${id}`).then(r => r.data.data),
  // Affectations
  listAssignments: (employeeId?: string): Promise<SchemeAssignment[]> =>
    api.get('/commissions/assignments', { params: employeeId ? { employeeId } : {} }).then(r => r.data.data),
  assign: (data: { employeeId: string; schemeId: string; validFrom: string; validTo?: string | null }) =>
    api.post('/commissions/assignments', data).then(r => r.data.data),
  unassign: (id: string) => api.delete(`/commissions/assignments/${id}`).then(r => r.data.data),
  // Versement sur la paie
  payout: (data: { from: string; to: string; payMonth: number; payYear: number; employeeId?: string }): Promise<PayoutResult> =>
    api.post('/commissions/payout', data).then(r => r.data.data),
  listPayouts: (employeeId?: string): Promise<CommissionPayout[]> =>
    api.get('/commissions/payouts', { params: employeeId ? { employeeId } : {} }).then(r => r.data.data),
};
