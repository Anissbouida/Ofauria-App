import api from './client';

export const productionEtapesApi = {
  // Étapes
  listByPlan: (planId: string) =>
    api.get(`/production-etapes/plans/${planId}/etapes`).then(r => r.data.data),
  listByItem: (itemId: string) =>
    api.get(`/production-etapes/items/${itemId}/etapes`).then(r => r.data.data),
  initialize: (itemId: string) =>
    api.post(`/production-etapes/items/${itemId}/etapes/init`).then(r => r.data.data),
  updateStatus: (etapeId: string, data: { status: string; checklist_resultats?: unknown[]; notes?: string; duree_reelle_min?: number }) =>
    api.put(`/production-etapes/etapes/${etapeId}/status`, data).then(r => r.data.data),
  startTimer: (etapeId: string) =>
    api.post(`/production-etapes/etapes/${etapeId}/timer`).then(r => r.data.data),
  completeRepetition: (etapeId: string, notes?: string) =>
    api.post(`/production-etapes/etapes/${etapeId}/repetition`, { notes }).then(r => r.data.data),
  checkBlocking: (itemId: string) =>
    api.get(`/production-etapes/items/${itemId}/etapes/check-blocking`).then(r => r.data.data),
  planProgress: (planId: string) =>
    api.get(`/production-etapes/plans/${planId}/etapes/progress`).then(r => r.data.data),

  // Rendement
  planRendement: (planId: string) =>
    api.get(`/production-etapes/plans/${planId}/rendement`).then(r => r.data.data),
  recordRendement: (itemId: string, data: {
    quantite_brute: number; quantite_nette_reelle: number;
    vers_magasin: number; vers_frigo?: number;
    pertes_detail?: { categorie: string; quantite: number; notes?: string }[];
    notes?: string;
  }) =>
    api.post(`/production-etapes/items/${itemId}/rendement`, data).then(r => r.data.data),
  getRendementTarget: (itemId: string) =>
    api.get(`/production-etapes/items/${itemId}/rendement/target`).then(r => r.data.data),

  // Dashboard
  rendementStats: (storeId: string, dateFrom?: string, dateTo?: string) =>
    api.get('/production-etapes/rendement/stats', { params: { storeId, dateFrom, dateTo } }).then(r => r.data.data),
  rendementByProduct: (storeId: string, dateFrom?: string, dateTo?: string) =>
    api.get('/production-etapes/rendement/by-product', { params: { storeId, dateFrom, dateTo } }).then(r => r.data.data),
};
