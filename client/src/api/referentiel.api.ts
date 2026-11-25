import api from './client';

export interface RefScope {
  lineage: string[];
  sectors: { code: string; label: string; primary: boolean }[];
  specializations: { code: string; label: string }[];
  modules: string[];
  history: { id: number; created_at: string; reason: string; activated: number; deactivated: number; kept_in_use: number }[];
}
export interface RefScopePreview {
  lineage: string[];
  activated: number;
  deactivated: number;
  tables: { table_id: string; label: string; activated: string[]; deactivated: string[]; active_after: number }[];
}

export const referentielApi = {
  /** Dashboard stats */
  dashboard: () =>
    api.get('/params/dashboard').then(r => r.data.data),

  /** List all registered reference tables */
  tables: () =>
    api.get('/params/tables').then(r => r.data.data),

  /** Unités de mesure actives (mig 515), lisibles par tout utilisateur connecté. */
  activeUnits: () =>
    api.get('/params/units/active').then(r => r.data.data) as Promise<{ code: string; label: string; category: string | null }[]>,

  /** List entries for a specific table */
  entries: (tableName: string, includeInactive = false) =>
    api.get(`/params/${tableName}`, { params: includeInactive ? { includeInactive: 'true' } : {} }).then(r => r.data.data),

  /** Create a new entry */
  create: (tableName: string, data: Record<string, any>) =>
    api.post(`/params/${tableName}`, data).then(r => r.data.data),

  /** Update an entry */
  update: (tableName: string, id: string, data: Record<string, any>) =>
    api.put(`/params/${tableName}/${id}`, data).then(r => r.data.data),

  /** Delete / deactivate an entry */
  remove: (tableName: string, id: string) =>
    api.delete(`/params/${tableName}/${id}`).then(r => r.data),

  /** Reactivate a soft-deleted entry */
  reactivate: (tableName: string, id: string) =>
    api.put(`/params/${tableName}/${id}/reactivate`).then(r => r.data.data),

  /** Mig 698 — secteurs, spécialités et modules qui pilotent les référentiels + dernières synchronisations. */
  scope: () =>
    api.get('/params/scope').then(r => r.data.data) as Promise<RefScope>,

  /** Mig 698 — effet d'un choix de secteurs/spécialités sur les référentiels, sans rien écrire. */
  scopePreview: (sectors: string[], specializations: string[] = []) =>
    api.get('/params/scope/preview', { params: { sectors: sectors.join(','), specializations: specializations.join(',') } })
      .then(r => r.data.data) as Promise<RefScopePreview>,

  /** Mig 698 — réaligne les valeurs « automatiques » sur le secteur configuré. */
  scopeSync: () =>
    api.post('/params/scope/sync', {}).then(r => r.data.data) as Promise<{ activated: number; deactivated: number; kept_in_use: number }>,

  /** Mig 698 — rend une valeur au réglage du secteur. */
  followSector: (tableName: string, id: string) =>
    api.put(`/params/${tableName}/${id}/follow-sector`, {}).then(r => r.data.data),

  /** Mig 698 — annule la surcharge du libellé d'une valeur livrée. */
  restoreLabel: (tableName: string, id: string) =>
    api.put(`/params/${tableName}/${id}/restore-label`, {}).then(r => r.data.data),

  /** Reorder entries */
  reorder: (tableName: string, orderedIds: string[]) =>
    api.put(`/params/${tableName}/reorder`, { orderedIds }).then(r => r.data),

  /** Audit log for a table */
  audit: (tableName: string, limit = 50) =>
    api.get(`/params/${tableName}/audit`, { params: { limit } }).then(r => r.data.data),

  /** Export entries as CSV */
  exportCsv: (tableName: string, entries: Record<string, any>[], tableLabel: string) => {
    const headers = ['Code', 'Libelle', 'Description', 'Couleur', 'Ordre', 'Actif'];
    const rows = entries.map((e: Record<string, any>) => [
      e.code || '',
      e.label || '',
      e.description || '',
      e.color || '',
      e.display_order || '',
      e.is_active !== false ? 'Oui' : 'Non',
    ]);
    const csvContent = [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tableLabel.replace(/[^a-zA-Z0-9]/g, '_')}_export.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
