import api from './client';

/** Plan de maîtrise sanitaire (mig 315) : relevés, nettoyage, actions correctives, contrôle à réception. */

export type ActionStatus = 'open' | 'done' | 'validated';
export type ActionSource = 'temperature' | 'cleaning' | 'reception' | 'other';
export type Frequency = 'daily' | 'weekly' | 'monthly';
export type EquipmentType = 'frigo' | 'surgele' | 'vitrine' | 'autre';

export type TodayEquipment = {
  id: string; nom: string; type: EquipmentType; temp_min: number; temp_max: number; readings_per_day: number;
  readings_today: number; last_value: number | null; last_in_range: boolean | null; last_at: string | null;
};
export type TodayTask = {
  id: string; zone: string; label: string; frequency: Frequency; method: string | null;
  last_done_at: string | null; last_conforme: boolean | null; last_done_by: string | null; due: boolean;
};
export type CorrectiveAction = {
  id: string; store_id: string | null; source_kind: ActionSource; source_id: string | null; problem: string;
  action_taken: string | null; status: ActionStatus; created_at: string; created_by_name: string | null;
  done_at: string | null; done_by_name: string | null; validated_at: string | null; validated_by_name: string | null;
  validation_note: string | null;
};
export type ReadingRow = {
  id: string; read_at: string; value: number; temp_min: number; temp_max: number; in_range: boolean; note: string | null;
  equipment_name: string; equipment_type: EquipmentType; read_by_name: string | null;
  action_id: string | null; action_status: ActionStatus | null; action_taken: string | null;
};
export type CleaningLogRow = {
  id: string; done_at: string; conforme: boolean; note: string | null; zone: string; label: string; frequency: Frequency;
  done_by_name: string | null; action_status: ActionStatus | null;
};
export type EquipmentConfig = {
  id: string; nom: string; type: EquipmentType; is_active: boolean; haccp_monitored: boolean;
  temp_min: number | null; temp_max: number | null; readings_per_day: number;
};
export type CleaningTask = {
  id: string; zone: string; label: string; frequency: Frequency; method: string | null; is_active: boolean; display_order: number;
};
export type ReceptionRow = {
  id: string; voucher_number: string; reception_date: string; status: string; supplier_name: string | null; received_by_name: string | null;
  temperature_ok: boolean | null; temperature_value: number | null; visual_ok: boolean | null; packaging_ok: boolean | null;
  labels_ok: boolean | null; overall_conformity: boolean | null; qc_notes: string | null; checked_at: string | null;
  checked_by_name: string | null; action_id: string | null; action_status: ActionStatus | null;
};

export const FREQUENCY_LABELS: Record<Frequency, string> = { daily: 'Quotidien', weekly: 'Hebdomadaire', monthly: 'Mensuel' };
export const EQUIPMENT_TYPE_LABELS: Record<EquipmentType, string> = { frigo: 'Frigo', surgele: 'Surgélation', vitrine: 'Vitrine', autre: 'Autre' };
export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = { open: 'À traiter', done: 'À valider', validated: 'Validée' };
export const ACTION_SOURCE_LABELS: Record<ActionSource, string> = { temperature: 'Température', cleaning: 'Nettoyage', reception: 'Réception', other: 'Autre' };

const data = <T>(p: Promise<{ data: { data: T } }>) => p.then(r => r.data.data);

export const haccpApi = {
  today: () => data<{ equipment: TodayEquipment[]; tasks: TodayTask[]; actions: CorrectiveAction[] }>(api.get('/haccp/today')),
  addReading: (body: { equipmentId: string; value: number; note?: string | null; actionTaken?: string | null }) =>
    data<{ reading: { in_range: boolean }; action: CorrectiveAction | null }>(api.post('/haccp/readings', body)),
  readings: (params: { from: string; to: string; equipmentId?: string; outOfRange?: 'true' }) =>
    data<ReadingRow[]>(api.get('/haccp/readings', { params })),
  logCleaning: (body: { taskId: string; conforme: boolean; note?: string | null; actionTaken?: string | null }) =>
    data(api.post('/haccp/cleaning-logs', body)),
  cleaningLogs: (params: { from: string; to: string }) => data<CleaningLogRow[]>(api.get('/haccp/cleaning-logs', { params })),
  actions: (params: { status?: string; from?: string; to?: string }) => data<CorrectiveAction[]>(api.get('/haccp/actions', { params })),
  createAction: (body: { problem: string; actionTaken?: string | null }) => data<CorrectiveAction>(api.post('/haccp/actions', body)),
  completeAction: (id: string, actionTaken: string) => data<CorrectiveAction>(api.post(`/haccp/actions/${id}/complete`, { actionTaken })),
  validateAction: (id: string, approve: boolean, note?: string | null) =>
    data<CorrectiveAction>(api.post(`/haccp/actions/${id}/validate`, { approve, note })),
  equipment: () => data<EquipmentConfig[]>(api.get('/haccp/equipment')),
  saveEquipment: (e: Omit<EquipmentConfig, 'id' | 'is_active'> & { id?: string }) => {
    const { id, ...body } = e;
    return data(id ? api.put(`/haccp/equipment/${id}`, body) : api.post('/haccp/equipment', body));
  },
  tasks: () => data<CleaningTask[]>(api.get('/haccp/tasks')),
  saveTask: (t: Omit<CleaningTask, 'id'> & { id?: string }) => {
    const { id, ...body } = t;
    return data(id ? api.put(`/haccp/tasks/${id}`, body) : api.post('/haccp/tasks', body));
  },
  receptions: (params: { from: string; to: string }) => data<ReceptionRow[]>(api.get('/haccp/receptions', { params })),
  checkReception: (id: string, body: {
    temperatureOk: boolean | null; temperatureValue: number | null; visualOk: boolean | null; packagingOk: boolean | null;
    labelsOk: boolean | null; overallConformity: boolean; notes?: string | null; actionTaken?: string | null;
  }) => data(api.post(`/haccp/receptions/${id}/check`, body)),
};
