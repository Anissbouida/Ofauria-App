import api from './client';

export const employeesApi = {
  list: () => api.get('/employees').then(r => r.data.data),
  getById: (id: string) => api.get(`/employees/${id}`).then(r => r.data.data),
  create: (data: Record<string, any>) => api.post('/employees', data).then(r => r.data.data),
  update: (id: string, data: Record<string, any>) => api.put(`/employees/${id}`, data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/employees/${id}`),
  /** Hard delete : supprime l'employe + cascade FK (paie, attendance, paiements, etc.).
   *  Action IRREVERSIBLE — admin uniquement. */
  hardDelete: (id: string) => api.delete(`/employees/${id}`, { params: { hard: 'true' } }).then(r => r.data.data),
  /** Compte les references vers l'employe (preview avant hard delete). */
  dependencies: (id: string) => api.get(`/employees/${id}/dependencies`).then(r => r.data.data),
};

export const schedulesApi = {
  list: (startDate: string, endDate: string, employeeId?: string) =>
    api.get('/schedules', { params: { startDate, endDate, employeeId } }).then(r => r.data.data),
  create: (data: Record<string, any>) => api.post('/schedules', data).then(r => r.data.data),
  update: (id: string, data: Record<string, any>) => api.put(`/schedules/${id}`, data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/schedules/${id}`),
  /** Charge la matrice hebdo (employes x 7 jours) avec verrouillage conges. */
  getWeek: (weekStart: string) =>
    api.get('/schedules/week', { params: { weekStart } }).then(r => r.data.data),
  /** Save bulk de toute la semaine. Renvoie 409 si conflit conge. */
  saveWeek: (weekStart: string, assignments: Array<{ employeeId: string; date: string; shiftCode: string | null }>) =>
    api.post('/schedules/week', { weekStart, assignments }).then(r => r.data.data),
};

export const shiftsApi = {
  list: () => api.get('/shifts').then(r => r.data.data),
};

export const attendanceApi = {
  list: (startDate: string, endDate: string, employeeId?: string) =>
    api.get('/attendance', { params: { startDate, endDate, employeeId } }).then(r => r.data.data),
  upsert: (data: Record<string, any>) => api.post('/attendance', data).then(r => r.data.data),
  bulkUpsert: (records: Record<string, any>[]) => api.post('/attendance/bulk', { records }).then(r => r.data.data),
  monthlySummary: (employeeId: string, month: number, year: number) =>
    api.get('/attendance/summary', { params: { employeeId, month, year } }).then(r => r.data.data),
  remove: (id: string) => api.delete(`/attendance/${id}`),
};

export const leavesApi = {
  list: (params?: Record<string, string>) => api.get('/leaves', { params }).then(r => r.data.data),
  create: (data: Record<string, any>) => api.post('/leaves', data).then(r => r.data.data),
  approve: (id: string) => api.post(`/leaves/${id}/approve`).then(r => r.data.data),
  reject: (id: string) => api.post(`/leaves/${id}/reject`).then(r => r.data.data),
  balance: (employeeId: string, year: number) =>
    api.get('/leaves/balance', { params: { employeeId, year: String(year) } }).then(r => r.data.data),
  remove: (id: string) => api.delete(`/leaves/${id}`),
};

export const payrollApi = {
  list: (params?: Record<string, string>) => api.get('/payroll', { params }).then(r => r.data.data),
  generate: (month: number, year: number) => api.post('/payroll/generate', { month, year }).then(r => r.data.data),
  update: (id: string, data: Record<string, any>) => api.put(`/payroll/${id}`, data).then(r => r.data.data),
  /** advanceDeduction : montant retenu sur les avances en cours (0 = aucune retenue). */
  markPaid: (id: string, paymentMethod: string, advanceDeduction = 0) =>
    api.post(`/payroll/${id}/pay`, { paymentMethod, advanceDeduction }).then(r => r.data.data),
  /** Annule le paiement : supprime la sortie de caisse liée + reverse les retenues d'avance. */
  unmarkPaid: (id: string) => api.post(`/payroll/${id}/unpay`).then(r => r.data.data),
};

export const advancesApi = {
  /** Liste des avances (avec remboursements). status='open' = non soldées. */
  list: (params?: Record<string, string>) => api.get('/salary-advances', { params }).then(r => r.data.data),
  /** Solde d'avances en cours par employé : [{ employee_id, outstanding }]. */
  outstanding: (employeeId?: string) =>
    api.get('/salary-advances/outstanding', { params: employeeId ? { employeeId } : undefined }).then(r => r.data.data),
  create: (data: Record<string, any>) => api.post('/salary-advances', data).then(r => r.data.data),
  /** Admin : plan de retenue/notes toujours modifiables ; montant/mode/date si aucune retenue imputée. */
  update: (id: string, data: Record<string, any>) => api.put(`/salary-advances/${id}`, data).then(r => r.data.data),
  remove: (id: string) => api.delete(`/salary-advances/${id}`).then(r => r.data.data),
};

export const weeklyPayrollApi = {
  /** Liste tous les employes weekly + leur ligne paie de la semaine (ou null si pas generee). */
  list: (weekStart: string) =>
    api.get('/weekly-payroll', { params: { weekStart } }).then(r => r.data.data),
  /** Calcule et upsert les lignes paie hebdo pour la semaine. */
  generate: (weekStart: string) =>
    api.post('/weekly-payroll/generate', { weekStart }).then(r => r.data.data),
  /** Marque paye + cree ecriture comptable. advanceDeduction = retenue sur avances. */
  markPaid: (id: string, paymentMethod: string, advanceDeduction = 0) =>
    api.post(`/weekly-payroll/${id}/pay`, { paymentMethod, advanceDeduction }).then(r => r.data.data),
  /** Annule le paiement : supprime la sortie de caisse liée + reverse les retenues d'avance. */
  unmarkPaid: (id: string) =>
    api.post(`/weekly-payroll/${id}/unpay`).then(r => r.data.data),
  remove: (id: string) => api.delete(`/weekly-payroll/${id}`),
};
