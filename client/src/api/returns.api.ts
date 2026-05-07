import api from './client';

export const returnsApi = {
  list: (params?: Record<string, string>) => api.get('/returns', { params }).then(r => r.data),
  searchSale: (saleNumber: string) => api.get('/returns/search', { params: { saleNumber } }).then(r => r.data.data),
  create: (data: Record<string, any>) => api.post('/returns', data).then(r => r.data.data),
};
