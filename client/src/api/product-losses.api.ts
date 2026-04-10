import api from './client';

export const productLossesApi = {
  list: (params?: Record<string, string>) =>
    api.get('/product-losses', { params }).then(r => r.data.data),

  stats: (month: number, year: number) =>
    api.get('/product-losses/stats', { params: { month, year } }).then(r => r.data.data),

  create: (data: Record<string, unknown>) =>
    api.post('/product-losses', data).then(r => r.data.data),

  remove: (id: string) =>
    api.delete(`/product-losses/${id}`),
};
