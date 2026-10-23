import api from './client';

/** Contrôle de gestion (mig 317) : budget vs réel, résultat par magasin, marges. */

export type BudgetHeader = {
  id: string; fiscal_year: number; store_id: string | null; name: string; status: 'draft' | 'approved';
  approved_at: string | null; approved_by_name: string | null;
};

export type BudgetRow = {
  id: string; code: string; label: string; account_class: 6 | 7; rubrique: string; rubrique_label: string;
  budget: number[]; actual: number[]; budget_year: number; actual_year: number; budget_ytd: number; actual_ytd: number;
};

export type BudgetComparison = {
  year: number; budget: BudgetHeader | null; elapsed_months: number; rows: BudgetRow[];
  totals: Record<'produits' | 'charges' | 'resultat', { budget: number[]; actual: number[] }>;
};

export type MarginGroup = {
  key: string; qty: number; revenue: number; revenue_costed: number; cost: number; margin: number;
  margin_pct: number | null; coverage_pct: number | null; products: number; products_without_cost: number; products_incoherent: number;
};

export type MarginToFix = {
  name: string; category: string | null; unit_cost: number | null; cost_source: string | null;
  qty: number; revenue: number; avg_price: number; issue: 'missing' | 'incoherent';
};

const data = <T>(p: Promise<{ data: { data: T } }>) => p.then(r => r.data.data);

export const managementApi = {
  budget: (year: number) => data<BudgetComparison>(api.get('/gestion/budget', { params: { year } })),
  createBudget: (body: { year: number; name: string; init: 'empty' | 'previous_actual'; revenuePct: number; chargesPct: number }) =>
    data<BudgetHeader>(api.post('/gestion/budget', body)),
  saveLines: (id: string, lines: { account_id: string; month: number; amount: number }[]) =>
    api.put(`/gestion/budget/${id}/lines`, { lines }).then(r => r.data),
  setStatus: (id: string, status: 'draft' | 'approved') => data<BudgetHeader>(api.post(`/gestion/budget/${id}/status`, { status })),
  deleteBudget: (id: string) => api.delete(`/gestion/budget/${id}`).then(r => r.data),
  resultByStore: (year: number) =>
    data<Array<{ store_id: string | null; store_name: string | null; produits: number; charges: number; resultat: number }>>(api.get('/gestion/result-by-store', { params: { year } })),
  margins: (params: { from: string; to: string; groupBy: 'category' | 'channel' | 'product' }) =>
    data<{ groups: MarginGroup[]; toFix: MarginToFix[]; total: Omit<MarginGroup, 'key' | 'qty' | 'products' | 'products_without_cost' | 'products_incoherent'> }>(
      api.get('/gestion/margins', { params })),
};
