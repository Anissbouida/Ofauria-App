import api from './client';

export type CostBreakdownItem = {
  product_id: string;
  name: string;
  category: string | null;
  qty_sold: string;
  revenue: string;
  unit_food_cost: string;
  food_cost: string;
  cost_from_production: boolean;
  cost_from_recipe: boolean;
  has_cost_data: boolean;
};

export type CostSummary = {
  period: { from: string; to: string };
  netSales: number;
  foodCost: number;
  laborCost: number;
  energyCost: number;
  lossesCost: number;
  primeCost: number;
  totalCost: number;
  foodCostPct: number;
  laborCostPct: number;
  energyCostPct: number;
  lossesCostPct: number;
  primeCostPct: number;
  totalCostPct: number;
  breakdown: CostBreakdownItem[];
  coverage: { plansCompleted: number; plansWithCost: number };
  targets: {
    foodCostPctMin: number;
    foodCostPctMax: number;
    laborCostPctMax: number;
    primeCostPctMax: number;
  };
};

export type MenuEngineeringClass = 'STAR' | 'PUZZLE' | 'HORSE' | 'DOG';

export type MenuEngineeringItem = {
  product_id: string;
  name: string;
  category: string | null;
  qty_sold: string;
  revenue: string;
  unit_food_cost: string;
  has_cost_data: boolean;
  cost_from_production: boolean;
  cost_from_recipe: boolean;
  total_food_cost: string;
  total_contribution: string;
  food_cost_pct: string;
  unit_margin: string;
  median_qty: string;
  median_contribution: string;
  classification: MenuEngineeringClass;
};

export type MenuEngineering = {
  period: { from: string; to: string };
  items: MenuEngineeringItem[];
  thresholds: { medianQty: number; medianContribution: number };
  counts: Record<MenuEngineeringClass, number>;
  costSources: { production: number; recipe: number; manual: number; missing: number };
  missingCostCount: number;
};

export type FinanceOverview = {
  period: { dateFrom: string; dateTo: string };
  kpis: {
    engagement: { total: number; count: number };
    treasury: {
      total: number;
      byMethod: {
        cash: { count: number; total: number };
        check: { count: number; total: number };
        transfer: { count: number; total: number };
        bank: { count: number; total: number };
      };
    };
    remainingToPay: { total: number; count: number };
    receivedNotInvoiced: { total: number; count: number };
  };
  pipeline: {
    unpaidInvoices: { total: number; count: number };
    uncashedChecks: {
      total: number; count: number;
      overdue: number; next7d: number; next30d: number; later: number;
    };
    receivedNotInvoiced: {
      total: number; count: number;
      list: Array<{
        id: string; orderNumber: string; supplierName: string;
        deliveryDate: string; total: number;
      }>;
    };
  };
  topSuppliers: Array<{
    id: string; name: string;
    unpaidTotal: number; unpaidCount: number;
    uncashedChecksTotal: number; uncashedChecksCount: number;
    totalDue: number;
  }>;
};

/** Une carte du Pilotage qui ouvre un detail au clic */
export type FinanceDetailKind =
  | 'engagement'
  | 'treasury'
  | 'remainingToPay'
  | 'receivedNotInvoiced'
  | 'unpaidInvoices'
  | 'uncashedChecks';

/** Ligne de detail derriere une carte (champs optionnels selon le kind) */
export type FinanceDetailRow = {
  id: string;
  ref?: string | null;
  supplierRef?: string | null;
  supplierName?: string | null;
  date?: string | null;
  dueDate?: string | null;
  method?: string | null;
  type?: string | null;
  label?: string | null;
  status?: string | null;
  total?: number;
  paid?: number;
  amount: number;
};

export const reportsApi = {
  dashboard: () => api.get('/reports/dashboard').then(r => r.data.data),
  /** Vue Pilotage : engagement, tresorerie, pipeline, fournisseurs crediteurs */
  financeOverview: (dateFrom: string, dateTo: string): Promise<FinanceOverview> =>
    api.get('/reports/finance-overview', { params: { dateFrom, dateTo } }).then(r => r.data.data),
  /** Liste detaillee derriere une carte du Pilotage (drill-down au clic) */
  financeOverviewDetail: (kind: FinanceDetailKind, dateFrom: string, dateTo: string): Promise<FinanceDetailRow[]> =>
    api.get('/reports/finance-overview/detail', { params: { kind, dateFrom, dateTo } }).then(r => r.data.data),
  sales: (startDate: string, endDate: string) => api.get('/reports/sales', { params: { startDate, endDate } }).then(r => r.data.data),
  products: (startDate: string, endDate: string) => api.get('/reports/products', { params: { startDate, endDate } }).then(r => r.data.data),
  costSummary: (startDate: string, endDate: string): Promise<CostSummary> =>
    api.get('/reports/cost-summary', { params: { startDate, endDate } }).then(r => r.data.data),
  menuEngineering: (startDate: string, endDate: string, categoryId?: string): Promise<MenuEngineering> =>
    api.get('/reports/menu-engineering', { params: { startDate, endDate, categoryId } }).then(r => r.data.data),

  // Rapports configurables (mig 394)
  customSources: (): Promise<ReportSource[]> => api.get('/reports/custom/sources').then(r => r.data.data),
  customFilterOptions: (source: string, filter: string): Promise<string[]> =>
    api.get('/reports/custom/filter-options', { params: { source, filter } }).then(r => r.data.data),
  customRun: (config: ReportRunConfig): Promise<ReportRunResult> =>
    api.post('/reports/custom/run', config).then(r => r.data.data),
  customList: (): Promise<SavedReport[]> => api.get('/reports/custom/definitions').then(r => r.data.data),
  customCreate: (data: { name: string; sourceKey: string; config: ReportConfig }) =>
    api.post('/reports/custom/definitions', data).then(r => r.data.data),
  customUpdate: (id: string, data: { name: string; sourceKey: string; config: ReportConfig }) =>
    api.put(`/reports/custom/definitions/${id}`, data).then(r => r.data.data),
  customDelete: (id: string) => api.delete(`/reports/custom/definitions/${id}`).then(r => r.data.data),
  // Tableaux de bord (mig 395)
  dashboards: (): Promise<DashboardSummary[]> => api.get('/reports/custom/dashboards').then(r => r.data.data),
  getDashboard: (id: string): Promise<Dashboard> => api.get(`/reports/custom/dashboards/${id}`).then(r => r.data.data),
  dashboardCreate: (data: { name: string; tiles?: DashboardTile[] }): Promise<{ id: string }> =>
    api.post('/reports/custom/dashboards', data).then(r => r.data.data),
  dashboardUpdate: (id: string, data: { name: string; tiles: DashboardTile[] }) =>
    api.put(`/reports/custom/dashboards/${id}`, data).then(r => r.data.data),
  dashboardDelete: (id: string) => api.delete(`/reports/custom/dashboards/${id}`).then(r => r.data.data),
};

export type DashboardTile = { id: string; title: string; source_key: string; config: ReportConfig; viz: 'table' | 'bar' | 'line' | 'kpi' };
export type DashboardSummary = { id: string; name: string; tile_count: number; created_by_name: string | null; updated_at: string };
export type Dashboard = { id: string; name: string; tiles: DashboardTile[]; created_at: string; updated_at: string };

export type ReportField = { key: string; label: string; type?: string; format?: string };
export type ReportSource = { key: string; label: string; dimensions: ReportField[]; measures: ReportField[]; filters: ReportField[] };
export type ReportConfig = { dimensions: string[]; measures: string[]; filters: Record<string, string>; dateFrom?: string; dateTo?: string; sort?: { key: string; dir: 'asc' | 'desc' }; viz?: 'table' | 'bar' | 'line' | 'kpi' };
export type ReportRunConfig = ReportConfig & { sourceKey: string; limit?: number };
export type ReportColumn = { key: string; label: string; kind: 'dimension' | 'measure'; type?: string; format?: string };
export type ReportRunResult = { columns: ReportColumn[]; rows: Record<string, any>[]; source_key: string };
export type SavedReport = { id: string; name: string; source_key: string; config: ReportConfig; created_by_name: string | null; created_at: string; updated_at: string };
