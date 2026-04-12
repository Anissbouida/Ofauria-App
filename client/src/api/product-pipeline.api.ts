import api from './client';

export const productPipelineApi = {
  list: (params?: Record<string, string>) =>
    api.get('/product-pipeline', { params }).then(r => r.data.data),

  stats: () =>
    api.get('/product-pipeline/stats').then(r => r.data.data),

  getById: (id: string) =>
    api.get(`/product-pipeline/${id}`).then(r => r.data.data),

  history: (id: string) =>
    api.get(`/product-pipeline/${id}/history`).then(r => r.data.data),

  create: (data: Record<string, unknown>) =>
    api.post('/product-pipeline', data).then(r => r.data.data),

  updateStageData: (id: string, data: Record<string, unknown>) =>
    api.put(`/product-pipeline/${id}/stage-data`, data).then(r => r.data.data),

  advance: (id: string) =>
    api.post(`/product-pipeline/${id}/advance`).then(r => r.data.data),

  adminDecision: (id: string, decision: string, comments: string) =>
    api.post(`/product-pipeline/${id}/admin-decision`, { decision, comments }).then(r => r.data.data),

  integrate: (id: string) =>
    api.post(`/product-pipeline/${id}/integrate`).then(r => r.data.data),

  cancel: (id: string, reason: string) =>
    api.post(`/product-pipeline/${id}/cancel`, { reason }).then(r => r.data.data),
};
