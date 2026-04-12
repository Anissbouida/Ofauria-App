import api from './client';

export const referentielApi = {
  /** Dashboard stats */
  dashboard: () =>
    api.get('/params/dashboard').then(r => r.data.data),

  /** List all registered reference tables */
  tables: () =>
    api.get('/params/tables').then(r => r.data.data),

  /** List entries for a specific table */
  entries: (tableName: string, includeInactive = false) =>
    api.get(`/params/${tableName}`, { params: includeInactive ? { includeInactive: 'true' } : {} }).then(r => r.data.data),

  /** Create a new entry */
  create: (tableName: string, data: Record<string, unknown>) =>
    api.post(`/params/${tableName}`, data).then(r => r.data.data),

  /** Update an entry */
  update: (tableName: string, id: string, data: Record<string, unknown>) =>
    api.put(`/params/${tableName}/${id}`, data).then(r => r.data.data),

  /** Delete / deactivate an entry */
  remove: (tableName: string, id: string) =>
    api.delete(`/params/${tableName}/${id}`).then(r => r.data),

  /** Reactivate a soft-deleted entry */
  reactivate: (tableName: string, id: string) =>
    api.put(`/params/${tableName}/${id}/reactivate`).then(r => r.data.data),

  /** Reorder entries */
  reorder: (tableName: string, orderedIds: string[]) =>
    api.put(`/params/${tableName}/reorder`, { orderedIds }).then(r => r.data),

  /** Audit log for a table */
  audit: (tableName: string, limit = 50) =>
    api.get(`/params/${tableName}/audit`, { params: { limit } }).then(r => r.data.data),

  /** Export entries as CSV */
  exportCsv: (tableName: string, entries: Record<string, unknown>[], tableLabel: string) => {
    const headers = ['Code', 'Libelle', 'Description', 'Couleur', 'Ordre', 'Actif'];
    const rows = entries.map((e: Record<string, unknown>) => [
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
