import api from './client';

export const reportsApi = {
  dashboard: () => api.get('/reports/dashboard').then(r => r.data.data),
  sales: (startDate: string, endDate: string) => api.get('/reports/sales', { params: { startDate, endDate } }).then(r => r.data.data),
  products: (startDate: string, endDate: string) => api.get('/reports/products', { params: { startDate, endDate } }).then(r => r.data.data),
};
