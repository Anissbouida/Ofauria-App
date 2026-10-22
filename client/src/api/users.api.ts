import api from './client';

export const usersApi = {
  list: () => api.get('/users').then(r => r.data.data),
  create: (data: Record<string, any>) => api.post('/users', data).then(r => r.data.data),
  update: (id: string, data: Record<string, any>) => api.put(`/users/${id}`, data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/users/${id}`),
  getPermissions: (id: string) => api.get(`/users/${id}/permissions`).then(r => r.data.data),
  setPermissions: (id: string, permissions: Record<string, any>[]) =>
    api.put(`/users/${id}/permissions`, { permissions }).then(r => r.data.data),
  myPermissions: () => api.get('/users/me/permissions').then(r => r.data.data),
};

/** Rôle (table roles, mig 330) : 9 rôles système + rôles créés. */
export interface RoleRow {
  code: string;
  label: string;
  description: string | null;
  base_role: string;
  is_system: boolean;
  is_active: boolean;
  user_count: number;
  module_count: number;
}
export interface RolePermission {
  module: string; canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean;
  /** Verbes métier accordés (mig 335) : approuver, valider, comptabiliser… */
  verbs?: string[];
  /** Portée des données (mig 335) : 'own' | 'store' | 'all'. */
  scope?: string;
  config?: Record<string, unknown>;
}
export interface AccessDenial {
  route: string; role_code: string; hits: number; users: number; user_names: string; last_at: string; modules: string[] | null;
}

// ─── Gouvernance (mig 336) ──────────────────────────────────────────────
export interface SodRuleRow {
  id: number; code: string; label: string; description: string | null;
  a_module: string; a_right: string; b_module: string; b_right: string;
  severity: 'warning' | 'critical'; is_active: boolean;
}
export interface SodViolationReport {
  userId: string; name: string; roleCode: string;
  violations: { code: string; label: string; severity: string; a: { module: string; right: string }; b: { module: string; right: string } }[];
}
export interface ApprovalLimitRow {
  id: number; role_code: string; role_label: string; document_type: string; max_amount: string | number; currency: string;
}
export interface DelegationRow {
  id: number; from_user_id: string; to_user_id: string; role_code: string; role_label: string;
  from_name: string; to_name: string; reason: string | null; starts_at: string; ends_at: string; active: boolean;
}

export const governanceApi = {
  // Séparation des tâches
  sodList: () => api.get('/users/sod').then(r => r.data.data) as Promise<SodRuleRow[]>,
  sodViolations: () => api.get('/users/sod/violations').then(r => r.data.data) as Promise<SodViolationReport[]>,
  sodMode: () => api.get('/users/sod/mode').then(r => r.data.data) as Promise<{ mode: 'off' | 'log' | 'enforce' }>,
  setSodMode: (mode: 'off' | 'log' | 'enforce') => api.put('/users/sod/mode', { mode }).then(r => r.data.data),
  sodCreate: (data: Record<string, unknown>) => api.post('/users/sod', data).then(r => r.data.data),
  sodUpdate: (code: string, data: Record<string, unknown>) => api.put(`/users/sod/${code}`, data).then(r => r.data.data),
  sodRemove: (code: string) => api.delete(`/users/sod/${code}`),
  // Plafonds d'approbation
  limitsList: () => api.get('/users/approval-limits').then(r => r.data.data) as Promise<ApprovalLimitRow[]>,
  limitsSet: (data: { roleCode: string; documentType: string; maxAmount: number; currency?: string }) =>
    api.post('/users/approval-limits', data).then(r => r.data.data),
  limitsRemove: (id: number) => api.delete(`/users/approval-limits/${id}`),
  // Délégations
  delegationsList: () => api.get('/users/delegations').then(r => r.data.data) as Promise<DelegationRow[]>,
  delegationsCreate: (data: { fromUserId: string; toUserId: string; roleCode: string; endsAt: string; startsAt?: string; reason?: string }) =>
    api.post('/users/delegations', data).then(r => r.data.data),
  delegationsRemove: (id: number) => api.delete(`/users/delegations/${id}`),
};

export const rolesApi = {
  list: () => api.get('/users/roles').then(r => r.data.data) as Promise<RoleRow[]>,
  create: (data: { label: string; baseRole: string; copyFrom?: string; description?: string }) =>
    api.post('/users/roles', data).then(r => r.data.data) as Promise<RoleRow>,
  update: (code: string, data: Partial<{ label: string; description: string; baseRole: string; isActive: boolean }>) =>
    api.put(`/users/roles/${code}`, data).then(r => r.data.data),
  remove: (code: string) => api.delete(`/users/roles/${code}`),
  permissions: (code: string) => api.get(`/users/roles/${code}/permissions`).then(r => r.data.data) as Promise<RolePermission[]>,
  setPermissions: (code: string, permissions: RolePermission[]) =>
    api.put(`/users/roles/${code}/permissions`, { permissions }).then(r => r.data.data),
  security: () => api.get('/users/security').then(r => r.data.data) as Promise<{ mode: 'off' | 'log' | 'enforce'; denials: AccessDenial[] }>,
  setSecurityMode: (mode: 'off' | 'log' | 'enforce') => api.put('/users/security', { mode }).then(r => r.data.data),
};
