import api from './client';

export const packagingApi = {
  list: (params?: { search?: string; category?: string; activeOnly?: boolean }) =>
    api.get('/packaging-items', { params }).then(r => r.data.data),

  getById: (id: string) =>
    api.get(`/packaging-items/${id}`).then(r => r.data.data),

  create: (data: Record<string, any>) =>
    api.post('/packaging-items', data).then(r => r.data.data),

  update: (id: string, data: Record<string, any>) =>
    api.put(`/packaging-items/${id}`, data).then(r => r.data.data),

  remove: (id: string) =>
    api.delete(`/packaging-items/${id}`),

  /** Ajustement direct du stock (reception, perte, ajustement manuel). */
  adjustStock: (id: string, data: { quantity: number; type?: string; note?: string; unitCost?: number }) =>
    api.post(`/packaging-items/${id}/adjust-stock`, data).then(r => r.data.data),

  /** Historique des mouvements de stock pour un emballage. */
  transactions: (id: string) =>
    api.get(`/packaging-items/${id}/transactions`).then(r => r.data.data),
};
