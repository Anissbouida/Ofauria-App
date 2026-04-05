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

export const attendanceApi = {
  list: (startDate: string, endDate: string, employeeId?: string) =>
    api.get('/attendance', { params: { startDate, endDate, employeeId } }).then(r => r.data.data),
  upsert: (data: Record<string, unknown>) => api.post('/attendance', data).then(r => r.data.data),
  bulkUpsert: (records: Record<string, unknown>[]) => api.post('/attendance/bulk', { records }).then(r => r.data.data),
  monthlySummary: (employeeId: string, month: number, year: number) =>
    api.get('/attendance/summary', { params: { employeeId, month, year } }).then(r => r.data.data),
  remove: (id: string) => api.delete(`/attendance/${id}`),
};

export const leavesApi = {
  list: (params?: Record<string, string>) => api.get('/leaves', { params }).then(r => r.data.data),
  create: (data: Record<string, unknown>) => api.post('/leaves', data).then(r => r.data.data),
  approve: (id: string) => api.post(`/leaves/${id}/approve`).then(r => r.data.data),
  reject: (id: string) => api.post(`/leaves/${id}/reject`).then(r => r.data.data),
  balance: (employeeId: string, year: number) =>
    api.get('/leaves/balance', { params: { employeeId, year: String(year) } }).then(r => r.data.data),
  remove: (id: string) => api.delete(`/leaves/${id}`),
};

export const payrollApi = {
  list: (params?: Record<string, string>) => api.get('/payroll', { params }).then(r => r.data.data),
  generate: (month: number, year: number) => api.post('/payroll/generate', { month, year }).then(r => r.data.data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/payroll/${id}`, data).then(r => r.data.data),
  markPaid: (id: string, paymentMethod: string) => api.post(`/payroll/${id}/pay`, { paymentMethod }).then(r => r.data.data),
};
