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

export const reportsApi = {
  dashboard: () => api.get('/reports/dashboard').then(r => r.data.data),
  sales: (startDate: string, endDate: string) => api.get('/reports/sales', { params: { startDate, endDate } }).then(r => r.data.data),
  products: (startDate: string, endDate: string) => api.get('/reports/products', { params: { startDate, endDate } }).then(r => r.data.data),
  costSummary: (startDate: string, endDate: string): Promise<CostSummary> =>
    api.get('/reports/cost-summary', { params: { startDate, endDate } }).then(r => r.data.data),
  menuEngineering: (startDate: string, endDate: string, categoryId?: string): Promise<MenuEngineering> =>
    api.get('/reports/menu-engineering', { params: { startDate, endDate, categoryId } }).then(r => r.data.data),
};
