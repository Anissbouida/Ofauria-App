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

  // Relevés de procédé par fournée (mig 422)
  addReading: (etapeId: string, data: { parametre: string; consigne?: number | null; tolerance?: number | null; mesure: number; est_ccp?: boolean; note?: string }) =>
    api.post(`/production-etapes/etapes/${etapeId}/readings`, data).then(r => r.data.data),
  deleteReading: (readingId: string) =>
    api.delete(`/production-etapes/readings/${readingId}`).then(r => r.data.data),

  // Rétro-planning par temps de procédé (mig 432) — épic labo L6
  computeRetroPlanning: (planId: string, heure_vitrine: string) =>
    api.post(`/production-etapes/plans/${planId}/retro-planning`, { heure_vitrine }).then(r => r.data.data as {
      scheduled_count: number;
      earliest_start: string | null;
      conflicts: { work_center_id: string; work_center_name: string; a: string; b: string; overlap_start: string; overlap_end: string }[];
    }),

  // Exécution d'atelier (mig 399) — roadmap lot 4
  assign: (etapeId: string, data: { workCenterId?: string | null; assignedEmployeeId?: string | null }) =>
    api.put(`/production-etapes/etapes/${etapeId}/assign`, data).then(r => r.data.data),
  pause: (etapeId: string) =>
    api.post(`/production-etapes/etapes/${etapeId}/pause`).then(r => r.data.data),
  resume: (etapeId: string) =>
    api.post(`/production-etapes/etapes/${etapeId}/resume`).then(r => r.data.data),
  atelierLive: (storeId?: string) =>
    api.get('/production-etapes/atelier/live', { params: { storeId } }).then(r => r.data.data),
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
    // Le serveur renvoie aussi `frigo` : surplus pousse automatiquement au stock frigo
    // (quantite ajoutee, lot) ou avertissement si ce n'etait pas possible.
    api.post(`/production-etapes/items/${itemId}/rendement`, data).then(r => ({
      rendement: r.data.data as Record<string, unknown>,
      frigo: (r.data.frigo ?? {}) as { added?: number; lot_number?: string | null; warning?: string },
    })),
  getRendementTarget: (itemId: string) =>
    api.get(`/production-etapes/items/${itemId}/rendement/target`).then(r => r.data.data),

  // Dashboard
  rendementStats: (storeId: string, dateFrom?: string, dateTo?: string) =>
    api.get('/production-etapes/rendement/stats', { params: { storeId, dateFrom, dateTo } }).then(r => r.data.data),
  rendementByProduct: (storeId: string, dateFrom?: string, dateTo?: string) =>
    api.get('/production-etapes/rendement/by-product', { params: { storeId, dateFrom, dateTo } }).then(r => r.data.data),
};
