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
  /** Historique des changements de salaire / frequence (qui, quand, ancien -> nouveau). */
  salaryHistory: (id: string) => api.get(`/employees/${id}/salary-history`).then(r => r.data.data),
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
  /** Genere les bulletins du mois. `removed` = bulletins non payes retires
   *  (employe passe en hebdo/quinzaine) : a signaler a l'utilisateur. */
  generate: (month: number, year: number) => api.post('/payroll/generate', { month, year })
    .then(r => ({ payrolls: r.data.data, removed: (r.data.removed ?? []) as Array<{ employee_id: string; first_name: string; last_name: string; pay_frequency: string }> })),
  update: (id: string, data: Record<string, any>) => api.put(`/payroll/${id}`, data).then(r => r.data.data),
  /** advanceDeduction : montant retenu sur les avances en cours (0 = aucune retenue). */
  markPaid: (id: string, paymentMethod: string, advanceDeduction = 0) =>
    api.post(`/payroll/${id}/pay`, { paymentMethod, advanceDeduction }).then(r => r.data.data),
  /** Annule le paiement : supprime la sortie de caisse liée + reverse les retenues d'avance. */
  unmarkPaid: (id: string) => api.post(`/payroll/${id}/unpay`).then(r => r.data.data),
  /** Lignes de rubriques du bulletin (fixes + manuelles). */
  lines: (id: string) => api.get(`/payroll/${id}/lines`).then(r => r.data.data),
  /** Remplace les lignes manuelles et recalcule le bulletin. */
  setLines: (id: string, lines: Array<{ rubriqueId: string; amount: number; label?: string | null }>) =>
    api.put(`/payroll/${id}/lines`, { lines }).then(r => r.data.data),
  /** Bulletin PDF genere serveur (blob). */
  pdf: (id: string) => api.get(`/payroll/${id}/pdf`, { responseType: 'blob' }),
  period: (month: number, year: number) =>
    api.get('/payroll/period', { params: { month, year } }).then(r => r.data.data),
  closePeriod: (month: number, year: number) => api.post('/payroll/period/close', { month, year }).then(r => r.data.data),
  reopenPeriod: (month: number, year: number) => api.post('/payroll/period/reopen', { month, year }).then(r => r.data.data),
};

/** Parametrage de la paie : bareme, reglages employeur, rubriques, elements fixes. */
export const payrollConfigApi = {
  settings: () => api.get('/payroll/settings').then(r => r.data.data),
  updateSettings: (data: Record<string, any>) => api.put('/payroll/settings', data).then(r => r.data.data),
  updateTaxScale: (id: string, data: Record<string, any>) => api.put(`/payroll/tax-scales/${id}`, data).then(r => r.data.data),
  rubriques: (all = false) => api.get('/payroll/rubriques', { params: all ? { all: 'true' } : undefined }).then(r => r.data.data),
  createRubrique: (data: Record<string, any>) => api.post('/payroll/rubriques', data).then(r => r.data.data),
  updateRubrique: (id: string, data: Record<string, any>) => api.put(`/payroll/rubriques/${id}`, data).then(r => r.data.data),
  items: (employeeId: string) => api.get(`/payroll/items/employee/${employeeId}`).then(r => r.data.data),
  createItem: (employeeId: string, data: Record<string, any>) => api.post(`/payroll/items/employee/${employeeId}`, data).then(r => r.data.data),
  updateItem: (id: string, data: Record<string, any>) => api.put(`/payroll/items/${id}`, data).then(r => r.data.data),
  removeItem: (id: string) => api.delete(`/payroll/items/${id}`).then(r => r.data.data),
  /** Etats CNSS / IR / CIMR du mois + declarations deja faites. */
  declarations: (month: number, year: number) =>
    api.get('/payroll/declarations', { params: { month, year } }).then(r => r.data.data),
  annualIr: (year: number) => api.get('/payroll/declarations/annual-ir', { params: { year } }).then(r => r.data.data),
  declare: (data: { kind: string; month: number; year: number; reference?: string | null }) =>
    api.post('/payroll/declarations/declare', data).then(r => r.data.data),
  settle: (data: { kind: string; month: number; year: number; paymentMethod: string; paymentDate: string }) =>
    api.post('/payroll/declarations/settle', data).then(r => r.data.data),
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

/** Paie par quinzaine (1-15 / 16-fin de mois), base salaire mensuel / 26. */
export const biweeklyPayrollApi = {
  /** periodStart = n'importe quelle date de la quinzaine (bornes recalculees serveur). */
  list: (periodStart: string) =>
    api.get('/payroll/biweekly', { params: { periodStart } }).then(r => r.data.data),
  generate: (periodStart: string) =>
    api.post('/payroll/biweekly/generate', { periodStart }).then(r => r.data.data),
  markPaid: (id: string, paymentMethod: string, advanceDeduction = 0) =>
    api.post(`/payroll/biweekly/${id}/pay`, { paymentMethod, advanceDeduction }).then(r => r.data.data),
  unmarkPaid: (id: string) =>
    api.post(`/payroll/biweekly/${id}/unpay`).then(r => r.data.data),
  remove: (id: string) => api.delete(`/payroll/biweekly/${id}`),
};
