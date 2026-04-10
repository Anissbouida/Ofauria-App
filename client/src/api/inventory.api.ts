import api from './client';

export const inventoryApi = {
  list: () => api.get('/inventory').then(r => r.data.data),
  alerts: () => api.get('/inventory/alerts').then(r => r.data.data),
  restock: (data: { ingredientId: string; quantity: number; note?: string; supplierLotNumber?: string; expirationDate?: string; manufacturedDate?: string }) => api.post('/inventory/restock', data).then(r => r.data),
  adjust: (data: { ingredientId: string; quantity: number; type: string; note?: string }) => api.post('/inventory/adjust', data),
  updateThreshold: (data: { ingredientId: string; threshold: number }) => api.put('/inventory/threshold', data),
  transactions: (ingredientId?: string) => api.get('/inventory/transactions', { params: { ingredientId } }).then(r => r.data.data),
};

export const ingredientLotsApi = {
  list: (params?: Record<string, string>) => api.get('/ingredient-lots', { params }).then(r => r.data),
  getById: (id: string) => api.get(`/ingredient-lots/${id}`).then(r => r.data.data),
  expiring: (days: number = 7) => api.get('/ingredient-lots/expiring', { params: { days } }).then(r => r.data.data),
  expired: () => api.get('/ingredient-lots/expired').then(r => r.data.data),
  stats: () => api.get('/ingredient-lots/stats').then(r => r.data.data),
  traceability: (lotId: string) => api.get(`/ingredient-lots/${lotId}/traceability`).then(r => r.data.data),
  productionLots: (planId: string) => api.get(`/ingredient-lots/production/${planId}`).then(r => r.data.data),
  quarantine: (id: string) => api.post(`/ingredient-lots/${id}/quarantine`).then(r => r.data.data),
  markAsWaste: (id: string) => api.post(`/ingredient-lots/${id}/waste`).then(r => r.data.data),
  saveQualityCheck: (rvId: string, data: Record<string, unknown>) => api.post(`/ingredient-lots/quality-check/${rvId}`, data).then(r => r.data.data),
  getQualityCheck: (rvId: string) => api.get(`/ingredient-lots/quality-check/${rvId}`).then(r => r.data.data),
};

export const ingredientsApi = {
  list: () => api.get('/ingredients').then(r => r.data.data),
  getById: (id: string) => api.get(`/ingredients/${id}`).then(r => r.data.data),
  create: (data: Record<string, unknown>) => api.post('/ingredients', data).then(r => r.data.data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/ingredients/${id}`, data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/ingredients/${id}`),
};
