import api from './client';

export type QualityKind = 'ok' | 'measure';
export type AppliesTo = 'general' | 'reception' | 'production' | 'product';
export interface QualityItem { label: string; kind: QualityKind; unit?: string; min?: number | null; max?: number | null }
export interface QualityResult { label: string; kind: QualityKind; ok: boolean; value?: number | null; note?: string | null }

export interface QualityTemplate {
  id: string; name: string; applies_to: AppliesTo; items: QualityItem[]; is_active: boolean; inspections_count: number;
}
export interface QualityInspectionRow {
  id: string; template_name: string; title: string; reference_note: string | null; inspected_on: string;
  conformity: boolean; notes: string | null; inspected_by_name: string | null; items: number; failed: number;
}
export interface QualityInspection extends QualityInspectionRow { results: QualityResult[]; template_id: string | null }

export const qualityApi = {
  templates: (): Promise<QualityTemplate[]> => api.get('/quality/templates').then(r => r.data.data),
  createTemplate: (data: { name: string; appliesTo: AppliesTo; items: QualityItem[] }): Promise<QualityTemplate> =>
    api.post('/quality/templates', data).then(r => r.data.data),
  updateTemplate: (id: string, data: { name?: string; appliesTo?: AppliesTo; items?: QualityItem[] }): Promise<QualityTemplate> =>
    api.put(`/quality/templates/${id}`, data).then(r => r.data.data),
  setTemplateActive: (id: string, active: boolean) => api.post(`/quality/templates/${id}/active`, { active }).then(r => r.data.data),
  inspections: (conformity?: boolean): Promise<QualityInspectionRow[]> =>
    api.get('/quality/inspections', { params: conformity === undefined ? {} : { conformity } }).then(r => r.data.data),
  getInspection: (id: string): Promise<QualityInspection> => api.get(`/quality/inspections/${id}`).then(r => r.data.data),
  createInspection: (data: { templateId?: string | null; title: string; referenceNote?: string | null; inspectedOn?: string | null; results: QualityResult[]; notes?: string | null }): Promise<QualityInspection> =>
    api.post('/quality/inspections', data).then(r => r.data.data),
  users: (): Promise<{ id: string; name: string }[]> => api.get('/quality/users').then(r => r.data.data),
  nonconformities: (status?: string): Promise<NonConformity[]> =>
    api.get('/quality/nonconformities', { params: status ? { status } : {} }).then(r => r.data.data),
  createNonConformity: (data: NonConformityInput): Promise<NonConformity> =>
    api.post('/quality/nonconformities', data).then(r => r.data.data),
  updateNonConformity: (id: string, data: Partial<NonConformityInput> & { status?: NcStatus }): Promise<NonConformity> =>
    api.put(`/quality/nonconformities/${id}`, data).then(r => r.data.data),
};

export type NcStatus = 'open' | 'in_progress' | 'closed';
export type NcSeverity = 'low' | 'medium' | 'high';
export type NcSource = 'inspection' | 'reception' | 'production' | 'complaint' | 'other';
export interface NonConformity {
  id: string; title: string; source: NcSource; reference_note: string | null; description: string | null;
  severity: NcSeverity; corrective_action: string | null; responsible_id: string | null; responsible_name: string | null;
  due_date: string | null; status: NcStatus; detected_on: string; detected_by_name: string | null; closed_at: string | null; overdue: boolean;
}
export interface NonConformityInput {
  title: string; source?: NcSource; referenceNote?: string | null; description?: string | null;
  severity?: NcSeverity; correctiveAction?: string | null; responsibleId?: string | null; dueDate?: string | null; detectedOn?: string | null;
}
