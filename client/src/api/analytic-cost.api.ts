import api from './client';

/** Comptabilité analytique du coût de revient (mig 655) : /production-cout/analytique/*. */
export type Driver = 'units' | 'weight_kg' | 'labour_hours' | 'machine_hours' | 'batches' | 'material_cost' | 'sales_value';
export type Level = 'approvisionnement' | 'production' | 'administration' | 'distribution';
export type Behavior = 'fixed' | 'variable' | 'semi_variable';
export interface FV { fixed: number; variable: number }

export interface AnalyticMeta {
  drivers: { value: Driver; label: string; unit: string }[];
  levels: { value: Level; label: string }[];
  natures: { value: string; label: string; behavior: Behavior; fixedPct: number; center: string; hint: string }[];
  method: 'rate' | 'monthly' | 'analytic';
}

export interface Centre {
  id: string; code: string; name: string; is_active: boolean; kind: 'principal' | 'auxiliaire'; level: Level; driver: Driver;
  parent_id: string | null; transfer_basis: 'percent' | 'headcount' | 'payroll'; sort_order: number; description: string | null;
  normal_capacity: number | null; max_capacity: number | null; transfers: { toId: string; percent: number }[];
}

export interface Charge {
  id: string; label: string; nature: string; behavior: Behavior; fixed_pct: number; assignment: 'direct' | 'indirect';
  cost_center_id: string | null; center_code: string | null; center_name: string | null;
  allocation_key_id: string | null; key_name: string | null; product_id: string | null; product_name: string | null;
  normal_quantity: number | null; monthly_amount: number; actual_amount: number | null; is_active: boolean; notes: string | null;
}

export interface AnalyticKey { id: string; name: string; is_active: boolean; lines: { centerId: string; percent: number }[] }

export interface EmployeeCost {
  id: string; name: string; role: string | null; budget: number; actual: number; source: 'payroll' | 'last_payroll' | 'estimate';
  hourlyRate: number; allocations: { centerId: string; percent: number; laborType: 'direct' | 'indirect' }[]; unallocated: boolean;
}

export interface CentreModel {
  id: string; code: string; name: string; kind: 'principal' | 'auxiliaire'; level: Level; driver: Driver;
  lines: { source: string; label: string; budget: FV; actual: FV }[];
  primary: { budget: FV; actual: FV }; received: { budget: FV; actual: FV }; ceded: { budget: FV; actual: FV }; pool: { budget: FV; actual: FV };
  normalCapacity: number | null; capacitySource: 'configured' | 'history' | 'projection' | 'none'; maxCapacity: number | null;
  activity: number; activityRate: number | null; utilisationRate: number | null; rateFixed: number; rateVariable: number;
  imputed: FV; activityVariance: number; budgetVariance: number;
}

export interface PeriodReport {
  month: string; elapsedRatio: number; daysElapsed: number; daysInMonth: number; inProgress: boolean;
  centres: CentreModel[];
  direct: { id: string; label: string; productName: string; budget: FV; actual: FV; normalQuantity: number | null; activity: number;
            rateFixed: number; rateVariable: number; imputed: FV; activityVariance: number; budgetVariance: number }[];
  employees: EmployeeCost[];
  transfers: { from: string; to: string; amount: number }[];
  activity: Record<Driver, number>; plansCount: number; timedLabour: number;
  directLabour: { rate: number; paidHours: number; timedHours: number; standardHours: number; imputed: number; unproductiveHours: number };
  totals: { charges: number; actual: number; budget: number; imputed: number; activityVariance: number; budgetVariance: number; control: number };
  warnings: string[];
  method: 'rate' | 'monthly' | 'analytic';
  plans: { total: number; costed: number; revient: number; charges: number };
}

export interface ChargeInput {
  label: string; nature: string; behavior: Behavior; fixedPct: number; assignment: 'direct' | 'indirect';
  costCenterId?: string | null; allocationKeyId?: string | null; productId?: string | null; normalQuantity?: number | null;
  monthlyAmount: number; notes?: string | null; isActive?: boolean;
}

const B = '/production-cout/analytique';
export const analyticCostApi = {
  meta: (): Promise<AnalyticMeta> => api.get(`${B}/meta`).then(r => r.data.data),
  setMethod: (method: 'rate' | 'analytic') => api.put(`${B}/methode`, { method }).then(r => r.data.data),
  period: (month: string): Promise<PeriodReport> => api.get(`${B}/periode`, { params: { month } }).then(r => r.data.data),
  recalc: (month: string): Promise<{ total: number; calculated: number; failed: number }> => api.post(`${B}/recalculer`, { month }).then(r => r.data.data),
  centres: (): Promise<Centre[]> => api.get(`${B}/centres`).then(r => r.data.data),
  createCentre: (b: { code: string; name: string; kind: string; level: string; driver: string; parentId?: string | null }) =>
    api.post(`${B}/centres`, b).then(r => r.data.data),
  updateCentre: (id: string, b: Record<string, unknown>) => api.put(`${B}/centres/${id}`, b).then(r => r.data.data),
  keys: (): Promise<AnalyticKey[]> => api.get(`${B}/cles`).then(r => r.data.data),
  saveKey: (id: string | null, b: { name: string; lines: { centerId: string; percent: number }[] }) =>
    (id ? api.put(`${B}/cles/${id}`, b) : api.post(`${B}/cles`, b)).then(r => r.data.data),
  charges: (month: string): Promise<Charge[]> => api.get(`${B}/charges`, { params: { month } }).then(r => r.data.data),
  saveCharge: (id: string | null, b: ChargeInput) => (id ? api.put(`${B}/charges/${id}`, b) : api.post(`${B}/charges`, b)).then(r => r.data.data),
  setChargeActive: (id: string, active: boolean) => api.put(`${B}/charges/${id}/actif`, { active }).then(r => r.data.data),
  setActual: (id: string, month: string, amount: number | null) => api.put(`${B}/charges/${id}/reel`, { month, amount }).then(r => r.data.data),
  personnel: (month: string): Promise<EmployeeCost[]> => api.get(`${B}/personnel`, { params: { month } }).then(r => r.data.data),
  setAllocations: (employeeId: string, allocations: { centerId: string; percent: number; laborType: 'direct' | 'indirect' }[]) =>
    api.put(`${B}/personnel/${employeeId}`, { allocations }).then(r => r.data.data),
};
