import api from './client';

export const bonSortieApi = {
  // Generate a bon de sortie for a plan.
  // Le backend peut renvoyer 200 avec data: null + reason (plan sans ingredients par ex.) :
  // on retourne l'enveloppe complete { data, reason } pour que l'UI puisse distinguer.
  generate: (planId: string, storeId: string) =>
    api.post('/bons-sortie/generate', { planId, storeId })
       .then(r => ({ data: r.data.data, reason: r.data.reason as string | undefined })),

  // Get bon(s) for a plan
  getByPlan: (planId: string) =>
    api.get(`/bons-sortie/plan/${planId}`).then(r => r.data.data),

  // File d'attente magasinier : BSI a preparer / en cours / prets pour le store
  warehouseQueue: () =>
    api.get('/bons-sortie/warehouse/queue').then(r => r.data.data),

  // Historique magasinier : BSI valides par le chef (prelevement+) ou annules
  warehouseHistory: (params?: { limit?: number; offset?: number }) =>
    api.get('/bons-sortie/warehouse/history', { params }).then(r => r.data),

  // Lignes BSI en attente de transfert Economat -> Pesage (vue magasinier)
  transferRequests: () =>
    api.get('/bons-sortie/warehouse/transfer-requests').then(r => r.data.data),

  // Lignes BSI en rupture totale, vue cross-BSI pour l'onglet "Ingredients a commander"
  // (module Economat). Permet au magasinier de commander en lot.
  ruptureRequests: () =>
    api.get('/bons-sortie/warehouse/rupture-requests').then(r => r.data.data),

  // Get a single bon by id
  getById: (bonId: string) =>
    api.get(`/bons-sortie/${bonId}`).then(r => r.data.data),

  // Start prelevement (picking)
  startPrelevement: (bonId: string) =>
    api.put(`/bons-sortie/${bonId}/prelevement`).then(r => r.data.data),

  // ─── Workflow Magasinier ───
  // Magasinier : prendre en charge un BSI (genere -> preparation)
  markPreparation: (bonId: string) =>
    api.put(`/bons-sortie/${bonId}/preparation`).then(r => r.data.data),
  // Magasinier : marquer pret a remettre (preparation -> pret)
  markReady: (bonId: string) =>
    api.put(`/bons-sortie/${bonId}/ready`).then(r => r.data.data),
  // Chef : refuser la reception avec motif (pret -> preparation)
  chefReject: (bonId: string, reason: string) =>
    api.put(`/bons-sortie/${bonId}/chef-reject`, { reason }).then(r => r.data.data),

  // Update a line's actual quantity
  updateLigne: (ligneId: string, data: { actualQuantity: number; notes?: string }) =>
    api.put(`/bons-sortie/ligne/${ligneId}`, data).then(r => r.data.data),

  // Verify the bon
  verify: (bonId: string) =>
    api.put(`/bons-sortie/${bonId}/verify`).then(r => r.data.data),

  // Close the bon
  close: (bonId: string) =>
    api.put(`/bons-sortie/${bonId}/close`).then(r => r.data.data),

  // Cancel the bon
  cancel: (bonId: string) =>
    api.put(`/bons-sortie/${bonId}/cancel`).then(r => r.data.data),

  // Handle ecart (discrepancy) on a line
  handleEcart: (bonId: string, ligneId: string, data: { substituteLotId?: string; newQuantity?: number }) =>
    api.put(`/bons-sortie/${bonId}/ecart/${ligneId}`, data).then(r => r.data.data),

  // Regenerate bon for a plan
  regenerate: (planId: string, storeId?: string) =>
    api.post(`/bons-sortie/plan/${planId}/regenerate`, { storeId }).then(r => r.data.data),

  // Delta v1 point 4 : liste FEFO des lots Economat disponibles pour une ligne BSI.
  // Le magasinier l'utilise pour confirmer le lot suggere ou en choisir un autre.
  economatLotsForLigne: (ligneId: string) =>
    api.get(`/bons-sortie/ligne/${ligneId}/economat-lots`).then(r => r.data.data),

  // Magasinier : transferer une ligne BSI Economat -> Pesage (ouverture contenant).
  // Le lot suggere peut etre substitue via overrideLotId, et la qty surchargee via overrideQty
  // (utile pour ouvrir un contenant entier au lieu de la portion exacte).
  transferLineFromEconomat: (
    ligneId: string,
    payload: { overrideLotId?: string; overrideQty?: number; reason?: string; containerCount?: number } = {},
  ) =>
    api.post(`/bons-sortie/ligne/${ligneId}/transfer-from-economat`, payload).then(r => r.data.data),

  // BSI partiel : valide ce qui est preleve, garde le reste en attente d'approvisionnement
  commitPartial: (bonId: string) =>
    api.put(`/bons-sortie/${bonId}/commit-partial`).then(r => r.data.data),

  // Apres reapprovisionnement : refait le FEFO sur les lignes en attente
  completePending: (bonId: string) =>
    api.put(`/bons-sortie/${bonId}/complete-pending`).then(r => r.data.data),
};
