import api from './client';

export const inventoryApi = {
  list: () => api.get('/inventory').then(r => r.data.data),
  alerts: () => api.get('/inventory/alerts').then(r => r.data.data),
  restock: (data: { ingredientId: string; quantity: number; note?: string; supplierLotNumber?: string; expirationDate?: string; manufacturedDate?: string }) => api.post('/inventory/restock', data).then(r => r.data),
  adjust: (data: { ingredientId: string; quantity: number; type: string; note?: string; reasonCode?: string }) => api.post('/inventory/adjust', data),
  updateThreshold: (data: { ingredientId: string; threshold: number }) => api.put('/inventory/threshold', data),
  transactions: (ingredientId?: string) => api.get('/inventory/transactions', { params: { ingredientId } }).then(r => r.data.data),
  /** Consommation matieres par periode (sorties de stock x cout unitaire). */
  consumption: (params: { dateFrom: string; dateTo: string }) =>
    api.get('/inventory/consumption', { params }).then(r => r.data.data),
  /** Achats matieres par periode (entrees de stock : BC + achat direct, prix de reception). */
  purchases: (params: { dateFrom: string; dateTo: string }) =>
    api.get('/inventory/purchases', { params }).then(r => r.data.data),
};

export type LotMovementType = 'open' | 'return' | 'waste' | 'losses' | 'quarantine';
export interface LotMovementPayload {
  type: LotMovementType;
  quantity?: number;
  containerCount?: number;
  reason?: string;
  /** Perte partielle : code du referentiel material_loss_reasons (mig 333). */
  reasonCode?: string;
  note?: string;
}

export const ingredientLotsApi = {
  list: (params?: Record<string, string>) => api.get('/ingredient-lots', { params }).then(r => r.data),
  getById: (id: string) => api.get(`/ingredient-lots/${id}`).then(r => r.data.data),
  expiring: (days: number = 7) => api.get('/ingredient-lots/expiring', { params: { days } }).then(r => r.data.data),
  expired: () => api.get('/ingredient-lots/expired').then(r => r.data.data),
  /** Stock actuel au Pesage (sacs ouverts), agrege par ingredient. Magasinier-only. */
  pesageStock: () => api.get('/ingredient-lots/pesage-stock').then(r => r.data.data),
  expiredActive: () => api.get('/ingredient-lots/expired-active').then(r => r.data.data),
  traceability: (lotId: string) => api.get(`/ingredient-lots/${lotId}/traceability`).then(r => r.data.data),
  productionLots: (planId: string) => api.get(`/ingredient-lots/production/${planId}`).then(r => r.data.data),
  quarantine: (id: string) => api.post(`/ingredient-lots/${id}/quarantine`).then(r => r.data.data),
  /**
   * Mouvement de lot unique (module Stock) : open (scelle -> entame), return (entame -> scelle),
   * waste (perte partielle en zone entamee), losses (lot entier aux pertes), quarantine.
   */
  movement: (id: string, data: LotMovementPayload) =>
    api.post(`/ingredient-lots/${id}/movement`, data).then(r => r.data.data),
  /** Zone pesage : ouverture a l'avance d'un contenant (economat -> pesage), hors bon de sortie. */
  openToPesage: (id: string, data: { quantity: number; containerCount?: number; reason?: string }) =>
    api.post(`/ingredient-lots/${id}/open-to-pesage`, data).then(r => r.data.data),
  /** Zone pesage : reliquat range en reserve (pesage -> economat, mouvement de zone trace). */
  returnToEconomat: (id: string, quantity: number, reason?: string) =>
    api.post(`/ingredient-lots/${id}/return-to-economat`, { quantity, reason }).then(r => r.data.data),
  /** Zone pesage : perte / casse sur la quantite perdue (sortie d'inventaire 'waste', motif obligatoire). */
  wasteFromPesage: (id: string, quantity: number, reason: string) =>
    api.post(`/ingredient-lots/${id}/pesage-waste`, { quantity, reason }).then(r => r.data.data),
  sendToLosses: (id: string, reason: string, note?: string) =>
    api.post(`/ingredient-lots/${id}/send-to-losses`, { reason, note }).then(r => r.data.data),
  saveQualityCheck: (rvId: string, data: Record<string, any>) => api.post(`/ingredient-lots/quality-check/${rvId}`, data).then(r => r.data.data),
  getQualityCheck: (rvId: string) => api.get(`/ingredient-lots/quality-check/${rvId}`).then(r => r.data.data),
  fefoPreview: (planId: string) => api.get(`/ingredient-lots/production/${planId}/fefo-preview`).then(r => r.data.data),
};

export const ingredientsApi = {
  list: () => api.get('/ingredients').then(r => r.data.data),
  getById: (id: string) => api.get(`/ingredients/${id}`).then(r => r.data.data),
  create: (data: Record<string, any>) => api.post('/ingredients', data).then(r => r.data.data),
  update: (id: string, data: Record<string, any>) => api.put(`/ingredients/${id}`, data).then(r => r.data.data),
  remove: (id: string, opts: { force?: boolean } = {}) =>
    api.delete(`/ingredients/${id}`, { params: opts.force ? { force: 'true' } : undefined }),
  /** Convertit un ingredient mal range en consommable (packaging_items). */
  convertToConsumable: (id: string, categoryId: string) =>
    api.post(`/ingredients/${id}/convert-to-consumable`, { categoryId }).then(r => r.data.data),
  /** Import xlsx — phase 1 : analyse + plan (creations/maj/inchanges) */
  importPreview: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/ingredients/import/preview', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data.data);
  },
  /** Import xlsx — phase 2 : applique creations + mises a jour */
  importCommit: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/ingredients/import/commit', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data.data);
  },
  /** Telecharge le xlsx export (declenche un download navigateur) */
  exportXlsx: async (filename = 'ingredients-economat.xlsx') => {
    const resp = await api.get('/ingredients/export', { responseType: 'blob' });
    const url = URL.createObjectURL(resp.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  /** Telecharge un modele xlsx vide (en-tete + ligne d'exemple) */
  downloadTemplate: async () => {
    const resp = await api.get('/ingredients/import/template', { responseType: 'blob' });
    const url = URL.createObjectURL(resp.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ingredients-modele-import.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
