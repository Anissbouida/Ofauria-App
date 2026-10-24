import api from './client';
import type { ApprovalDocType, ApprovalCondition, ApprovalRequestStatus, ApprovalStepStatus } from '@ofauria/shared';

/** Circuits d'approbation (lot 8 Paramètres, mig 347). */

export interface ApprovalStep {
  id: string; request_id: string; step_order: number;
  approver_role: string | null; approver_user_id: string | null; approver_name: string | null;
  status: ApprovalStepStatus; due_at: string | null;
  decided_by: string | null; decided_by_name: string | null; decided_at: string | null; reason: string | null;
  escalated_at: string | null;
}

export interface ApprovalRequest {
  id: string; rule_id: string | null; rule_code: string; rule_label: string;
  doc_type: ApprovalDocType; doc_id: string; doc_label: string;
  amount: string | null; summary: { values?: Record<string, unknown>; condition?: string; mode?: string };
  store_id: string | null; store_name: string | null;
  status: ApprovalRequestStatus;
  requested_by: string; requested_by_name: string | null; requested_at: string;
  decided_by: string | null; decided_by_name: string | null; decided_at: string | null; decision_reason: string | null;
  applied_at: string | null; apply_error: string | null;
  steps: ApprovalStep[];
}

export interface ApprovalRuleStep {
  id: string; rule_id: string; step_order: number;
  approver_role: string | null; approver_user_id: string | null; approver_name: string | null;
}

export interface ApprovalRule {
  id: string; code: string; label: string; doc_type: ApprovalDocType; enabled: boolean;
  condition: ApprovalCondition; mode: 'serial' | 'parallel'; escalate_after_hours: number | null;
  display_order: number; updated_at: string; updated_by_name: string | null;
  pending_count: number; requests_30d: number; rejected_30d: number;
  steps: ApprovalRuleStep[];
}

export interface ApprovalRuleInput {
  code?: string; label?: string; docType?: ApprovalDocType; enabled?: boolean;
  condition?: ApprovalCondition | null; mode?: 'serial' | 'parallel'; escalateAfterHours?: number | null;
  steps?: { approverRole?: string | null; approverUserId?: string | null }[];
}

export interface ApprovalDelegation {
  id: string; from_user_id: string; to_user_id: string; starts_on: string; ends_on: string;
  from_name: string; to_name: string;
}

export interface ApprovalDelegate { id: string; name: string; role: string; role_label: string }

export const approvalsApi = {
  inbox: () => api.get('/approvals/inbox').then(r => r.data.data) as Promise<ApprovalRequest[]>,
  count: () => api.get('/approvals/count').then(r => r.data.data.count as number),
  mine: () => api.get('/approvals/mine').then(r => r.data.data) as Promise<ApprovalRequest[]>,
  history: (params: { status?: string; docType?: string; limit?: number; offset?: number }) =>
    api.get('/approvals/history', { params }).then(r => ({ rows: r.data.data as ApprovalRequest[], total: r.data.total as number })),
  forDocument: (docType: string, docId: string) =>
    api.get(`/approvals/for/${docType}/${docId}`).then(r => r.data.data) as Promise<ApprovalRequest | null>,
  approve: (id: string, reason?: string) => api.post(`/approvals/${id}/approve`, { reason }).then(r => r.data.data) as Promise<ApprovalRequest>,
  reject: (id: string, reason: string) => api.post(`/approvals/${id}/reject`, { reason }).then(r => r.data.data) as Promise<ApprovalRequest>,
  cancel: (id: string, reason?: string) => api.post(`/approvals/${id}/cancel`, { reason }).then(r => r.data.data) as Promise<ApprovalRequest>,
  delegates: () => api.get('/approvals/delegates').then(r => r.data.data) as Promise<ApprovalDelegate[]>,
  delegations: () => api.get('/approvals/delegations').then(r => r.data.data) as Promise<ApprovalDelegation[]>,
  addDelegation: (data: { toUserId: string; startsOn?: string; endsOn: string }) =>
    api.post('/approvals/delegations', data).then(r => r.data.data) as Promise<ApprovalDelegation>,
  removeDelegation: (id: string) => api.delete(`/approvals/delegations/${id}`),
  // Paramètres › Circuits d'approbation
  rules: () => api.get('/settings/approval-rules').then(r => r.data.data) as Promise<ApprovalRule[]>,
  createRule: (data: ApprovalRuleInput) => api.post('/settings/approval-rules', data).then(r => r.data.data) as Promise<ApprovalRule>,
  updateRule: (code: string, data: ApprovalRuleInput) => api.put(`/settings/approval-rules/${code}`, data).then(r => r.data.data) as Promise<ApprovalRule>,
  deleteRule: (code: string) => api.delete(`/settings/approval-rules/${code}`),
};

/** Message d'erreur renvoyé par l'API, sinon repli. */
export function apiErrorMessage(err: unknown, fallback: string) {
  const e = err as { response?: { data?: { error?: { message?: string } | string } } };
  const er = e?.response?.data?.error;
  return typeof er === 'string' ? er : er?.message || fallback;
}
