import api from './client';

/** Maintenance (mig 359) : plans d'entretien et interventions. */
export type InterventionKind = 'preventive' | 'corrective' | 'installation' | 'warranty';
export type InterventionStatus = 'requested' | 'scheduled' | 'in_progress' | 'done' | 'cancelled';
export type Priority = 'low' | 'normal' | 'high' | 'critical';

export type MaintenanceEvent = {
  id: string; event_type: 'created' | 'comment' | 'status' | 'assigned' | 'scheduled' | 'edited';
  from_value: string | null; to_value: string | null; note: string | null; by_name: string | null; created_at: string;
};
export type Intervention = {
  id: string; number: string; store_id: string | null; kind: InterventionKind; status: InterventionStatus; priority: Priority; title: string;
  fixed_asset_id: string | null; asset_label: string | null; customer_id: string | null; customer_label: string | null;
  equipment_label: string | null; equipment_name: string | null; serial_no: string | null; location: string | null;
  plan_id: string | null; plan_label: string | null; complaint_id: string | null; complaint_number: string | null;
  project_id: string | null; project_number: string | null; reported_problem: string | null;
  assignee_id: string | null; assignee_name: string | null; scheduled_at: string | null; started_at: string | null; completed_at: string | null;
  work_done: string | null; downtime_hours: string | null; labor_hours: string | null; labor_rate: string | null; parts_cost: string;
  under_warranty: boolean; billable: boolean; billed_amount: string | null; photo_url: string | null; total_cost: string; is_overdue: boolean;
  created_by_name: string | null; created_at: string; updated_at: string; events?: MaintenanceEvent[];
};
export type MaintenancePlan = {
  id: string; label: string; fixed_asset_id: string | null; customer_id: string | null; equipment_label: string | null; equipment_name: string | null;
  customer_label: string | null; serial_no: string | null; frequency_days: number; checklist: string | null; assignee_id: string | null; assignee_name: string | null;
  last_done_on: string | null; next_due_on: string; is_active: boolean; is_overdue: boolean; is_due_soon: boolean; open_count: number;
};
export type InterventionInput = {
  kind?: InterventionKind; priority?: Priority; title: string; fixedAssetId?: string | null; customerId?: string | null; equipmentLabel?: string | null;
  serialNo?: string | null; location?: string | null; planId?: string | null; complaintId?: string | null; projectId?: string | null;
  reportedProblem?: string | null; assigneeId?: string | null; scheduledAt?: string | null; underWarranty?: boolean; billable?: boolean;
  workDone?: string | null; downtimeHours?: number | null; laborHours?: number | null; laborRate?: number | null; partsCost?: number; billedAmount?: number | null;
};
export type PlanInput = {
  label: string; fixedAssetId?: string | null; customerId?: string | null; equipmentLabel?: string | null; serialNo?: string | null;
  frequencyDays: number; checklist?: string | null; assigneeId?: string | null; nextDueOn: string; isActive?: boolean;
};

export const KIND_LABELS: Record<InterventionKind, string> = { preventive: 'Entretien préventif', corrective: 'Dépannage', installation: 'Installation', warranty: 'Garantie' };
export const STATUS_LABELS: Record<InterventionStatus, string> = { requested: 'À planifier', scheduled: 'Planifiée', in_progress: 'En cours', done: 'Terminée', cancelled: 'Annulée' };
export const PRIORITY_LABELS: Record<Priority, string> = { critical: 'Critique', high: 'Haute', normal: 'Normale', low: 'Basse' };

export const maintenanceApi = {
  list: (params: Record<string, string>): Promise<{ rows: Intervention[]; total: number; byStatus: Record<string, { count: number; overdue: number }> }> =>
    api.get('/maintenance', { params }).then(r => r.data.data),
  overview: (params: Record<string, string>): Promise<{
    interventions: { requested: number; scheduled: number; in_progress: number; overdue: number; critical: number };
    done: { count: number; cost: string; downtime: string; corrective: number; preventive: number };
    plans: { overdue: number; due_soon: number; active: number };
    duePlans: MaintenancePlan[];
  }> => api.get('/maintenance/overview', { params }).then(r => r.data.data),
  equipmentReport: (params: Record<string, string>): Promise<{ fixed_asset_id: string | null; equipment_name: string; customer_label: string | null; count: number; corrective: number; open: number; cost: string; downtime: string; last_done_at: string | null }[]> =>
    api.get('/maintenance/equipment-report', { params }).then(r => r.data.data),
  assets: (): Promise<{ id: string; label: string }[]> => api.get('/maintenance/lookup/assets').then(r => r.data.data),
  people: (): Promise<{ id: string; name: string; role: string | null; cost_rate: string }[]> => api.get('/maintenance/lookup/people').then(r => r.data.data),
  get: (id: string): Promise<Intervention> => api.get(`/maintenance/${id}`).then(r => r.data.data),
  create: (data: InterventionInput): Promise<Intervention> => api.post('/maintenance', data).then(r => r.data.data),
  update: (id: string, data: Partial<InterventionInput>): Promise<Intervention> => api.patch(`/maintenance/${id}`, data).then(r => r.data.data),
  setStatus: (id: string, data: { status: InterventionStatus; note?: string; workDone?: string; laborHours?: number | null; laborRate?: number | null; partsCost?: number | null; downtimeHours?: number | null; scheduledAt?: string | null }): Promise<Intervention> =>
    api.post(`/maintenance/${id}/status`, data).then(r => r.data.data),
  comment: (id: string, note: string): Promise<Intervention> => api.post(`/maintenance/${id}/comments`, { note }).then(r => r.data.data),
  plans: (activeOnly = false): Promise<MaintenancePlan[]> => api.get('/maintenance/plans', { params: activeOnly ? { activeOnly: 'true' } : {} }).then(r => r.data.data),
  savePlan: (data: PlanInput, id?: string): Promise<MaintenancePlan> => (id ? api.put(`/maintenance/plans/${id}`, data) : api.post('/maintenance/plans', data)).then(r => r.data.data),
  createFromPlan: (planId: string): Promise<Intervention> => api.post(`/maintenance/plans/${planId}/create-intervention`).then(r => r.data.data),
};
