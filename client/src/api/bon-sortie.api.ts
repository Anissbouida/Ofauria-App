import api from './client';

export const bonSortieApi = {
  // Generate a bon de sortie for a plan
  generate: (planId: string, storeId: string) =>
    api.post('/bons-sortie/generate', { planId, storeId }).then(r => r.data.data),

  // Get bon(s) for a plan
  getByPlan: (planId: string) =>
    api.get(`/bons-sortie/plan/${planId}`).then(r => r.data.data),

  // Get a single bon by id
  getById: (bonId: string) =>
    api.get(`/bons-sortie/${bonId}`).then(r => r.data.data),

  // Start prelevement (picking)
  startPrelevement: (bonId: string) =>
    api.put(`/bons-sortie/${bonId}/prelevement`).then(r => r.data.data),

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
};
