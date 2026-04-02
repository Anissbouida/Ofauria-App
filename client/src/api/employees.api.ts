import api from './client';

export const employeesApi = {
  list: () => api.get('/employees').then(r => r.data.data),
  getById: (id: string) => api.get(`/employees/${id}`).then(r => r.data.data),
  create: (data: Record<string, unknown>) => api.post('/employees', data).then(r => r.data.data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/employees/${id}`, data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/employees/${id}`),
};

export const schedulesApi = {
  list: (startDate: string, endDate: string, employeeId?: string) =>
    api.get('/schedules', { params: { startDate, endDate, employeeId } }).then(r => r.data.data),
  create: (data: Record<string, unknown>) => api.post('/schedules', data).then(r => r.data.data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/schedules/${id}`, data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/schedules/${id}`),
};
