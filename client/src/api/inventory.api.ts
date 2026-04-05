import api from './client';

export const inventoryApi = {
  list: () => api.get('/inventory').then(r => r.data.data),
  alerts: () => api.get('/inventory/alerts').then(r => r.data.data),
  restock: (data: { ingredientId: string; quantity: number; note?: string }) => api.post('/inventory/restock', data),
  adjust: (data: { ingredientId: string; quantity: number; type: string; note?: string }) => api.post('/inventory/adjust', data),
  updateThreshold: (data: { ingredientId: string; threshold: number }) => api.put('/inventory/threshold', data),
  transactions: (ingredientId?: string) => api.get('/inventory/transactions', { params: { ingredientId } }).then(r => r.data.data),
};

export const ingredientsApi = {
  list: () => api.get('/ingredients').then(r => r.data.data),
  getById: (id: string) => api.get(`/ingredients/${id}`).then(r => r.data.data),
  create: (data: Record<string, unknown>) => api.post('/ingredients', data).then(r => r.data.data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/ingredients/${id}`, data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/ingredients/${id}`),
};
