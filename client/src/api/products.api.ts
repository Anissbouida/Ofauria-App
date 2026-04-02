import api from './client';

export const productsApi = {
  list: (params?: Record<string, string>) => api.get('/products', { params }).then(r => r.data),
  getById: (id: string) => api.get(`/products/${id}`).then(r => r.data.data),
  create: (data: Record<string, unknown>) => api.post('/products', data).then(r => r.data.data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/products/${id}`, data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/products/${id}`),
  uploadImage: (id: string, file: File) => {
    const form = new FormData();
    form.append('image', file);
    return api.post(`/products/${id}/image`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data.data);
  },
};
