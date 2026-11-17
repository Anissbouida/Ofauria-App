import api from './client';

export interface WorkCenter { id: string; name: string; hourly_cost: number; is_active: boolean; operations_count: number; capacity_minutes_per_day: number | null; status?: string }
export interface Oee {
  downtime_min: number; planned_min: number; standard_min: number; reel_min: number; active_days: number;
  availability_pct: number | null; performance_pct: number | null; trs_pct: number | null;
}
export interface Downtime { id: string; from_time: string; to_time: string | null; reason: string; notes: string | null; operator_name: string | null; minutes: number }
export interface RoutingRow {
  id: string; name: string; product_id: string | null; product_name: string | null; notes: string | null;
  is_active: boolean; total_minutes: number; labor_cost: number; operations_count: number; batch_size: number;
}
export interface RoutingOperation {
  id: string; sequence: number; operation_name: string; work_center_id: string | null; work_center_name: string | null;
  hourly_cost: number; duration_min: number; operation_cost: number;
  // M5-01 : opération complète.
  op_type?: OpType; setup_min?: number; machine_min_per_unit?: number; labor_min_per_unit?: number; base_quantity?: number;
  control_point?: string | null; is_blocking?: boolean; temperature_c?: number | null; operation_name_ar?: string | null; instructions?: string | null;
  planned_labor_min?: number; planned_machine_min?: number;
}
export type OpType = 'reglage' | 'execution' | 'attente' | 'controle';
export const OP_TYPE_LABELS: Record<OpType, string> = { reglage: 'Réglage', execution: 'Exécution', attente: 'Attente', controle: 'Contrôle' };
export interface Routing extends RoutingRow { operations: RoutingOperation[]; recipe_id?: string | null; recipe_name?: string | null }
export interface OperationInput {
  operationName: string; workCenterId?: string | null; durationMin: number;
  opType?: OpType; setupMin?: number; machineMinPerUnit?: number; laborMinPerUnit?: number; baseQuantity?: number;
  controlPoint?: string | null; isBlocking?: boolean; temperatureC?: number | null; operationNameAr?: string | null; instructions?: string | null;
}
/** Opération lue → saisie (conserve tous les champs). */
export const opToInput = (o: RoutingOperation): OperationInput => ({
  operationName: o.operation_name, workCenterId: o.work_center_id, durationMin: o.duration_min,
  opType: o.op_type ?? 'execution', setupMin: o.setup_min ?? 0, machineMinPerUnit: o.machine_min_per_unit ?? 0,
  laborMinPerUnit: o.labor_min_per_unit ?? 0, baseQuantity: o.base_quantity ?? 1, controlPoint: o.control_point ?? null,
  isBlocking: o.is_blocking ?? false, temperatureC: o.temperature_c ?? null, operationNameAr: o.operation_name_ar ?? null, instructions: o.instructions ?? null,
});

export const routingsApi = {
  workCenters: (): Promise<WorkCenter[]> => api.get('/routings/work-centers').then(r => r.data.data),
  createWorkCenter: (data: { name: string; hourlyCost: number; capacityMinutesPerDay?: number | null }): Promise<WorkCenter> => api.post('/routings/work-centers', data).then(r => r.data.data),
  updateWorkCenter: (id: string, data: { name?: string; hourlyCost?: number; capacityMinutesPerDay?: number | null }): Promise<WorkCenter> =>
    api.put(`/routings/work-centers/${id}`, data).then(r => r.data.data),
  setWorkCenterActive: (id: string, active: boolean) => api.post(`/routings/work-centers/${id}/active`, { active }).then(r => r.data.data),
  list: (): Promise<RoutingRow[]> => api.get('/routings').then(r => r.data.data),
  getById: (id: string): Promise<Routing> => api.get(`/routings/${id}`).then(r => r.data.data),
  forRecipe: (recipeId: string): Promise<Routing | null> => api.get(`/routings/for-recipe/${recipeId}`).then(r => r.data.data),
  create: (data: { name: string; productId?: string | null; recipeId?: string | null; notes?: string | null; batchSize?: number }): Promise<Routing> => api.post('/routings', data).then(r => r.data.data),
  update: (id: string, data: { name?: string; productId?: string | null; recipeId?: string | null; notes?: string | null; batchSize?: number; operations?: OperationInput[] }): Promise<Routing> =>
    api.put(`/routings/${id}`, data).then(r => r.data.data),
  setActive: (id: string, active: boolean) => api.post(`/routings/${id}/active`, { active }).then(r => r.data.data),
  remove: (id: string) => api.delete(`/routings/${id}`).then(r => r.data),

  // Statut & arrêts machine / TRS (mig 402) — roadmap lot 7
  setWorkCenterStatus: (id: string, status: string): Promise<WorkCenter> =>
    api.post(`/routings/work-centers/${id}/status`, { status }).then(r => r.data.data),
  recordDowntime: (id: string, data: { fromTime: string; toTime?: string | null; reason: string; notes?: string | null }) =>
    api.post(`/routings/work-centers/${id}/downtime`, data).then(r => r.data.data),
  listDowntime: (id: string, from?: string, to?: string): Promise<Downtime[]> =>
    api.get(`/routings/work-centers/${id}/downtime`, { params: { from, to } }).then(r => r.data.data),
  oee: (id: string, from?: string, to?: string): Promise<Oee> =>
    api.get(`/routings/work-centers/${id}/oee`, { params: { from, to } }).then(r => r.data.data),
};
