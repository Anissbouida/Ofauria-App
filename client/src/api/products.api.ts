import api from './client';

export const productsApi = {
  list: (params?: Record<string, string>) => api.get('/products', { params }).then(r => r.data),
  getById: (id: string) => api.get(`/products/${id}`).then(r => r.data.data),
  create: (data: Record<string, unknown>) => api.post('/products', data).then(r => r.data.data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/products/${id}`, data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/products/${id}`).then(r => r.data),
  toggleAvailability: (id: string) => api.patch(`/products/${id}/toggle-availability`).then(r => r.data.data),
  uploadImage: (id: string, file: File) => {
    const form = new FormData();
    form.append('image', file);
    return api.post(`/products/${id}/image`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data.data);
  },
  adjustStock: (id: string, data: { quantity: number; type?: string; note?: string }) =>
    api.post(`/products/${id}/stock`, data).then(r => r.data.data),
  stockHistory: (id: string, params?: Record<string, string>) =>
    api.get(`/products/${id}/stock-history`, { params }).then(r => r.data),
  lowStock: () => api.get('/products/alerts/low-stock').then(r => r.data.data),
};
