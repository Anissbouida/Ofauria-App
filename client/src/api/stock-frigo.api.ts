import api from './client';

export const stockFrigoApi = {
  list: (storeId: string, includeExpired = false) =>
    api.get('/stock-frigo', { params: { storeId, includeExpired } }).then(r => r.data.data),
  summary: (storeId: string) =>
    api.get('/stock-frigo/summary', { params: { storeId } }).then(r => r.data.data),
  baseRecipes: (storeId: string) =>
    api.get('/stock-frigo/base-recipes', { params: { storeId } }).then(r => r.data.data),
  recipeLineage: (recipeId: string, storeId: string) =>
    api.get(`/stock-frigo/recipe-lineage/${recipeId}`, { params: { storeId } }).then(r => r.data.data),
  available: (productId: string, storeId: string) =>
    api.get(`/stock-frigo/available/${productId}`, { params: { storeId } }).then(r => r.data.data),
  addSurplus: (data: Record<string, unknown>) =>
    api.post('/stock-frigo/surplus', data).then(r => r.data.data),
  consume: (data: { productId: string; quantity: number; storeId?: string; referenceId?: string; referenceType?: string }) =>
    api.post('/stock-frigo/consume', data).then(r => r.data.data),
  recordLoss: (id: string, data: { quantity: number; type: 'loss' | 'expired'; notes?: string }) =>
    api.put(`/stock-frigo/${id}/loss`, data).then(r => r.data),
  adjust: (id: string, data: { quantity: number; notes?: string }) =>
    api.put(`/stock-frigo/${id}/adjust`, data).then(r => r.data),
  transactions: (id: string) =>
    api.get(`/stock-frigo/${id}/transactions`).then(r => r.data.data),
};
