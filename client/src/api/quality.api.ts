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
};
