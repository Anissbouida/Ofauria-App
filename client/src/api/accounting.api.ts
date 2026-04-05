import api from './client';

export const caisseApi = {
  register: (year: number, month: number) =>
    api.get('/caisse/register', { params: { year, month } }).then(r => r.data.data),
};

export const suppliersApi = {
  list: () => api.get('/suppliers').then(r => r.data.data),
  getById: (id: string) => api.get(`/suppliers/${id}`).then(r => r.data.data),
  create: (data: Record<string, unknown>) => api.post('/suppliers', data).then(r => r.data.data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/suppliers/${id}`, data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/suppliers/${id}`),
};

export const expenseCategoriesApi = {
  list: () => api.get('/expense-categories').then(r => r.data.data),
  create: (data: Record<string, unknown>) => api.post('/expense-categories', data).then(r => r.data.data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/expense-categories/${id}`, data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/expense-categories/${id}`),
};

export const invoicesApi = {
  list: (params?: Record<string, string>) => api.get('/invoices', { params }).then(r => r.data.data),
  getById: (id: string) => api.get(`/invoices/${id}`).then(r => r.data.data),
  create: (data: Record<string, unknown>) => api.post('/invoices', data).then(r => r.data.data),
  cancel: (id: string) => api.post(`/invoices/${id}/cancel`).then(r => r.data.data),
};

export const paymentsApi = {
  list: (params?: Record<string, string>) => api.get('/payments', { params }).then(r => r.data.data),
  create: (data: Record<string, unknown>) => api.post('/payments', data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/payments/${id}`),
  summary: (dateFrom: string, dateTo: string) =>
    api.get('/payments/summary', { params: { dateFrom, dateTo } }).then(r => r.data.data),
};
