import api from './client';

/**
 * Phase 10.2 — API publique : clés d'accès et webhooks (Paramètres › Intégrations).
 * La clé (`key`) et le secret (`secret`) ne sont renvoyés qu'à la création.
 */

export interface ApiKey {
  id: string; label: string; key_prefix: string; scopes: string[];
  store_id: string | null; last_used_at: string | null; revoked_at: string | null; created_at: string;
}
export interface WebhookEndpoint {
  id: string; label: string; url: string; events: string[]; is_active: boolean; created_at: string;
}

export const integrationsApi = {
  listKeys: (): Promise<ApiKey[]> => api.get('/settings/api-keys').then(r => r.data.data),
  createKey: (input: { label: string; scopes: string[]; storeId?: string | null }): Promise<ApiKey & { key: string }> =>
    api.post('/settings/api-keys', input).then(r => r.data.data),
  revokeKey: (id: string) => api.delete(`/settings/api-keys/${id}`).then(r => r.data),

  listWebhooks: (): Promise<WebhookEndpoint[]> => api.get('/settings/webhooks').then(r => r.data.data),
  createWebhook: (input: { label: string; url: string; events: string[] }): Promise<WebhookEndpoint & { secret: string }> =>
    api.post('/settings/webhooks', input).then(r => r.data.data),
  setWebhookActive: (id: string, active: boolean) => api.put(`/settings/webhooks/${id}`, { active }).then(r => r.data),
  removeWebhook: (id: string) => api.delete(`/settings/webhooks/${id}`).then(r => r.data),
};

/** Portées proposées à la création d'une clé. */
export const API_SCOPES: [string, string][] = [
  ['orders:create', 'Créer des commandes'],
  ['products:read', 'Lire le catalogue'],
];

/** Événements auxquels un webhook peut s'abonner. */
export const WEBHOOK_EVENTS: [string, string][] = [
  ['order.created', 'Commande créée'],
];
