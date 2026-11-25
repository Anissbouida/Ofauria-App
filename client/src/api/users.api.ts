import api from './client';

export const usersApi = {
  list: () => api.get('/users').then(r => r.data.data),
  create: (data: Record<string, any>) => api.post('/users', data).then(r => r.data.data),
  update: (id: string, data: Record<string, any>) => api.put(`/users/${id}`, data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/users/${id}`),
  /** Suppression définitive : refusée (409 USER_HAS_HISTORY) si le compte a déjà servi. */
  removePermanently: (id: string) => api.delete(`/users/${id}/permanent`),
  // Sécurité d'un compte (mig 617) : 2FA exigée / réinitialisée, verrou, sessions, mot de passe.
  setMfaRequired: (id: string, required: boolean) => api.put(`/users/${id}/mfa-required`, { required }).then(r => r.data.data),
  resetMfa: (id: string) => api.post(`/users/${id}/mfa-reset`, {}).then(r => r.data.data),
  unlock: (id: string) => api.post(`/users/${id}/unlock`, {}).then(r => r.data.data),
  revokeSessions: (id: string) => api.post(`/users/${id}/revoke-sessions`, {}).then(r => r.data.data),
  setMustChangePassword: (id: string, value: boolean) => api.put(`/users/${id}/must-change-password`, { value }).then(r => r.data.data),
  /** Politique : rôles qui doivent activer la double authentification. */
  mfaPolicy: () => api.get('/users/security/mfa-policy').then(r => r.data.data as { requiredRoles: string[] }),
  setMfaPolicy: (requiredRoles: string[]) => api.put('/users/security/mfa-policy', { requiredRoles }).then(r => r.data.data as { requiredRoles: string[] }),
  getPermissions: (id: string) => api.get(`/users/${id}/permissions`).then(r => r.data.data),
  setPermissions: (id: string, permissions: Record<string, any>[]) =>
    api.put(`/users/${id}/permissions`, { permissions }).then(r => r.data.data),
  /** G6-05 : langue de l'interface de l'utilisateur connecté (null = défaut de la société). */
  setMyLocale: (locale: 'fr' | 'ar' | 'en' | null) => api.put('/users/me/locale', { locale }).then(r => r.data.data),
  myPermissions: () => api.get('/users/me/permissions').then(r => r.data.data),
  /** Clés de droits par action de l'utilisateur connecté (constat 111). */
  myActionPermissions: (): Promise<string[]> => api.get('/users/me/action-permissions').then(r => r.data.data.keys as string[]),
  // Fiches salariees pour le lien espace employe (employees.user_id).
  employeesForLink: () => api.get('/users/employees-link').then(r => r.data.data) as Promise<{ id: string; name: string; user_id: string | null }[]>,
};

/** Rôle (table roles, mig 330) : 9 rôles système + rôles créés. */
export interface RoleRow {
  code: string;
  label: string;
  description: string | null;
  base_role: string;
  is_system: boolean;
  is_active: boolean;
  /** Mig 699 : faux pour un rôle d'un autre secteur sans titulaire (masqué des choix). */
  available?: boolean;
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

// ─── Revue des accès (Phase 3, outils admin) ────────────────────────────
export interface AccessReviewModuleRow {
  module: string; canView: boolean; canCreate: boolean; canEdit: boolean; canDelete: boolean;
  verbs: string[]; scope: string; grantedBy: string[];
}
export interface AccessReviewData {
  user: { id: string; name: string; email: string; storeId: string | null; isActive: boolean };
  isAdmin: boolean;
  source: 'admin' | 'user' | 'role';
  roles: { code: string; label: string; baseRole: string; delegated: boolean }[];
  baseRoles: string[];
  modules: AccessReviewModuleRow[];
  sodViolations: { code: string; label: string; severity: string; a: { module: string; right: string }; b: { module: string; right: string } }[];
  approvalLimits: { documentType: string; configured: boolean; limit: number | null }[];
}
export interface AccessHistoryEntry { at: string; actor: string | null; kind: string; detail: Record<string, unknown>; }
export interface AccessOverviewRow {
  userId: string; name: string; email: string; roles: string[]; hasCustomPerms: boolean; conflictCount: number; isActive: boolean;
}

export const accessReviewApi = {
  review: (id: string) => api.get(`/users/${id}/access-review`).then(r => r.data.data) as Promise<AccessReviewData>,
  history: (id: string) => api.get(`/users/${id}/access-history`).then(r => r.data.data) as Promise<AccessHistoryEntry[]>,
  overview: () => api.get('/users/access-overview').then(r => r.data.data) as Promise<AccessOverviewRow[]>,
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
  /** Permissions par action (M2-07) : référentiel + clés détenues par rôle. */
  actionMatrix: () => api.get('/users/roles/action-permissions').then(r => r.data.data) as Promise<{
    keys: { key: string; module: string; label: string }[]; byRole: Record<string, string[]>;
  }>,
  setActionPermissions: (code: string, keys: string[]) =>
    api.put(`/users/roles/${code}/action-permissions`, { keys }).then(r => r.data.data) as Promise<{ added: number; removed: number }>,
  userActionPermissions: (userId: string) =>
    api.get(`/users/${userId}/action-permissions`).then(r => r.data.data) as Promise<{ keys: string[] }>,
  security: () => api.get('/users/security').then(r => r.data.data) as Promise<{ mode: 'off' | 'log' | 'enforce'; denials: AccessDenial[] }>,
  setSecurityMode: (mode: 'off' | 'log' | 'enforce') => api.put('/users/security', { mode }).then(r => r.data.data),
};
