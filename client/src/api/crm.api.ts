import api from './client';
import type { CfValues } from './custom-fields.api';

/** CRM (mig 371) : opportunités, pipeline et activités commerciales. */
export type Stage = 'new' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
export type ActivityKind = 'call' | 'meeting' | 'email' | 'task' | 'note';
export type Opportunity = {
  id: string; number: string; title: string; stage: Stage; client_label: string | null;
  customer_id: string | null; prospect_name: string | null; prospect_company: string | null; prospect_phone: string | null; prospect_email: string | null; prospect_city: string | null;
  customer_phone: string | null; customer_email: string | null;
  source_code: string | null; source_label: string | null; expected_amount: string | null; probability: number; weighted_amount: string;
  expected_close_date: string | null; owner_id: string | null; owner_name: string | null; description: string | null;
  campaign_id: string | null;
  lost_reason_code: string | null; lost_reason_label: string | null; lost_note: string | null; closed_at: string | null;
  next_activity_id: string | null; next_activity_kind: ActivityKind | null; next_activity_subject: string | null; next_activity_due: string | null; activity_overdue: boolean;
  quote_count: number; custom_fields?: CfValues; created_at: string; updated_at: string;
  activities?: Activity[]; quotes?: { id: string; number: string; status: string; total: string; quote_date: string; valid_until: string }[];
};
export type Activity = {
  id: string; opportunity_id: string; kind: ActivityKind; subject: string; due_at: string | null; done_at: string | null; outcome: string | null;
  assigned_to: string | null; assigned_name: string | null; created_by_name: string | null; created_at: string;
  number?: string; title?: string; client_label?: string | null; overdue?: boolean;
};
export type OpportunityInput = {
  title: string; customerId?: string | null; prospectName?: string | null; prospectCompany?: string | null; prospectPhone?: string | null; prospectEmail?: string | null;
  prospectCity?: string | null; sourceCode?: string | null; expectedAmount?: number | null; probability?: number | null; expectedCloseDate?: string | null;
  ownerId?: string | null; description?: string | null; campaignId?: string | null;
};

export interface Campaign {
  id: string; name: string; start_date: string | null; end_date: string | null; budget: number | null;
  status: 'active' | 'closed'; notes: string | null;
  opportunities: number; won: number; lost: number; won_amount: number; pipeline_amount: number;
}
export interface CampaignOption { id: string; name: string }
export type CrmOverview = {
  byStage: Partial<Record<Stage, { count: number; amount: number; weighted: number }>>;
  month: { won: number; wonAmount: number; lost: number };
  conversion: { won: number; lost: number; rate: number | null };
  sources: { label: string; count: number; won: number; wonAmount: number }[];
  overdueActivities: number;
};

export const STAGES: { key: Stage; label: string; probability: number }[] = [
  { key: 'new', label: 'Nouveau', probability: 10 },
  { key: 'qualified', label: 'Qualifié', probability: 30 },
  { key: 'proposal', label: 'Proposition', probability: 60 },
  { key: 'negotiation', label: 'Négociation', probability: 80 },
  { key: 'won', label: 'Gagné', probability: 100 },
  { key: 'lost', label: 'Perdu', probability: 0 },
];
export const STAGE_LABEL = Object.fromEntries(STAGES.map(s => [s.key, s.label])) as Record<Stage, string>;
export const ACTIVITY_LABEL: Record<ActivityKind, string> = { call: 'Appel', meeting: 'Rendez-vous', email: 'E-mail', task: 'Tâche', note: 'Note' };

export const crmApi = {
  overview: (mine = false): Promise<CrmOverview> => api.get('/crm/overview', { params: mine ? { mine: 'true' } : {} }).then(r => r.data.data),
  owners: (): Promise<{ id: string; name: string; role: string }[]> => api.get('/crm/owners').then(r => r.data.data),
  list: (params: Record<string, string>): Promise<{ data: Opportunity[]; total: number }> => api.get('/crm/opportunities', { params }).then(r => ({ data: r.data.data, total: r.data.total })),
  get: (id: string): Promise<Opportunity> => api.get(`/crm/opportunities/${id}`).then(r => r.data.data),
  create: (data: OpportunityInput): Promise<Opportunity> => api.post('/crm/opportunities', data).then(r => r.data.data),
  update: (id: string, data: OpportunityInput): Promise<Opportunity> => api.put(`/crm/opportunities/${id}`, data).then(r => r.data.data),
  stage: (id: string, stage: Stage, extra: { lostReasonCode?: string | null; lostNote?: string | null } = {}): Promise<Opportunity> =>
    api.post(`/crm/opportunities/${id}/stage`, { stage, ...extra }).then(r => r.data.data),
  createCustomer: (id: string): Promise<Opportunity> => api.post(`/crm/opportunities/${id}/customer`).then(r => r.data.data),
  addActivity: (id: string, data: { kind: ActivityKind; subject: string; dueAt?: string | null; assignedTo?: string | null; outcome?: string | null; done?: boolean }) =>
    api.post(`/crm/opportunities/${id}/activities`, data).then(r => r.data.data as Activity),
  doneActivity: (id: string, outcome?: string | null) => api.post(`/crm/activities/${id}/done`, { outcome }).then(r => r.data.data),
  deleteActivity: (id: string) => api.delete(`/crm/activities/${id}`).then(r => r.data),
  todo: (all = false): Promise<Activity[]> => api.get('/crm/activities', { params: all ? { all: 'true' } : {} }).then(r => r.data.data),
  campaigns: (): Promise<Campaign[]> => api.get('/crm/campaigns').then(r => r.data.data),
  campaignOptions: (): Promise<CampaignOption[]> => api.get('/crm/campaign-options').then(r => r.data.data),
  createCampaign: (data: { name: string; startDate?: string | null; endDate?: string | null; budget?: number | null; notes?: string }): Promise<Campaign> =>
    api.post('/crm/campaigns', data).then(r => r.data.data),
  setCampaignStatus: (id: string, status: 'active' | 'closed') => api.post(`/crm/campaigns/${id}/status`, { status }).then(r => r.data.data),
};
