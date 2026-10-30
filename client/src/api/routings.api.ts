import api from './client';

export interface WorkCenter { id: string; name: string; hourly_cost: number; is_active: boolean; operations_count: number; capacity_minutes_per_day: number | null }
export interface RoutingRow {
  id: string; name: string; product_id: string | null; product_name: string | null; notes: string | null;
  is_active: boolean; total_minutes: number; labor_cost: number; operations_count: number; batch_size: number;
}
export interface RoutingOperation {
  id: string; sequence: number; operation_name: string; work_center_id: string | null; work_center_name: string | null;
  hourly_cost: number; duration_min: number; operation_cost: number;
}
export interface Routing extends RoutingRow { operations: RoutingOperation[] }
export interface OperationInput { operationName: string; workCenterId?: string | null; durationMin: number }

export const routingsApi = {
  workCenters: (): Promise<WorkCenter[]> => api.get('/routings/work-centers').then(r => r.data.data),
  createWorkCenter: (data: { name: string; hourlyCost: number; capacityMinutesPerDay?: number | null }): Promise<WorkCenter> => api.post('/routings/work-centers', data).then(r => r.data.data),
  updateWorkCenter: (id: string, data: { name?: string; hourlyCost?: number; capacityMinutesPerDay?: number | null }): Promise<WorkCenter> =>
    api.put(`/routings/work-centers/${id}`, data).then(r => r.data.data),
  setWorkCenterActive: (id: string, active: boolean) => api.post(`/routings/work-centers/${id}/active`, { active }).then(r => r.data.data),
  list: (): Promise<RoutingRow[]> => api.get('/routings').then(r => r.data.data),
  getById: (id: string): Promise<Routing> => api.get(`/routings/${id}`).then(r => r.data.data),
  create: (data: { name: string; productId?: string | null; notes?: string | null; batchSize?: number }): Promise<Routing> => api.post('/routings', data).then(r => r.data.data),
  update: (id: string, data: { name?: string; productId?: string | null; notes?: string | null; batchSize?: number; operations?: OperationInput[] }): Promise<Routing> =>
    api.put(`/routings/${id}`, data).then(r => r.data.data),
  setActive: (id: string, active: boolean) => api.post(`/routings/${id}/active`, { active }).then(r => r.data.data),
  remove: (id: string) => api.delete(`/routings/${id}`).then(r => r.data),
};
