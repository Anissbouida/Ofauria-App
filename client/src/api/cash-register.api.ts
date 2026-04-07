import api from './client';

export const cashRegisterApi = {
  list: (params?: Record<string, string>) => api.get('/cash-register', { params }).then(r => r.data),
  getById: (id: string) => api.get(`/cash-register/${id}`).then(r => r.data.data),
  currentSession: () => api.get('/cash-register/current').then(r => r.data.data),
  open: (openingAmount: number) => api.post('/cash-register/open', { openingAmount }).then(r => r.data.data),
  close: () => api.post('/cash-register/close').then(r => r.data.data),
  submitAmount: (id: string, data: { actualAmount: number; notes?: string }) => api.post(`/cash-register/${id}/submit`, data).then(r => r.data.data),
  getInventoryItems: (id: string) => api.get(`/cash-register/${id}/inventory`).then(r => r.data.data),
};
