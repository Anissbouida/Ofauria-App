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
  /** Alertes RH : fins de CDD et d'essai, pieces expirees ou manquantes. */
  hrAlerts: (days = 30) => api.get('/employees/hr-alerts', { params: { days } }).then(r => r.data.data),
  /** Pilotage RH de l'annee : effectif, turnover, masse salariale, absenteisme, cout horaire. */
  hrAnalytics: (year: number) => api.get('/employees/hr-analytics', { params: { year } }).then(r => r.data.data),
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
  /** Cumul annuel des heures sup par employe face au contingent legal. */
  overtimeSummary: (year: number) => api.get('/attendance/overtime-summary', { params: { year } }).then(r => r.data.data),
};

export const leavesApi = {
  list: (params?: Record<string, string>) => api.get('/leaves', { params }).then(r => r.data.data),
  create: (data: Record<string, any>) => api.post('/leaves', data).then(r => r.data.data),
  approve: (id: string) => api.post(`/leaves/${id}/approve`).then(r => r.data.data),
  reject: (id: string) => api.post(`/leaves/${id}/reject`).then(r => r.data.data),
  /** Solde detaille (par annee) d'un employe a une date. */
  balance: (employeeId: string, asOf?: string) =>
    api.get('/leaves/balance', { params: { employeeId, asOf } }).then(r => r.data.data),
  /** Soldes de tous les employes actifs. */
  balances: (asOf?: string) => api.get('/leaves/balances', { params: asOf ? { asOf } : undefined }).then(r => r.data.data),
  /** Jours decomptes + solde disponible pour une demande. */
  preview: (params: { employeeId: string; type: string; startDate: string; endDate: string }) =>
    api.get('/leaves/preview', { params }).then(r => r.data.data),
  holidays: (year?: number) => api.get('/leaves/holidays', { params: year ? { year } : undefined }).then(r => r.data.data),
  upsertHoliday: (data: { date: string; label: string; isConfirmed?: boolean }) => api.put('/leaves/holidays', data).then(r => r.data.data),
  removeHoliday: (date: string) => api.delete(`/leaves/holidays/${date}`).then(r => r.data.data),
  adjustments: (employeeId: string) => api.get(`/leaves/adjustments/${employeeId}`).then(r => r.data.data),
  createAdjustment: (employeeId: string, data: { year: number; days: number; reason: string }) =>
    api.post(`/leaves/adjustments/${employeeId}`, data).then(r => r.data.data),
  removeAdjustment: (id: string) => api.delete(`/leaves/adjustments/entry/${id}`).then(r => r.data.data),
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
  /** Fichier e-BDS Damancom genere depuis le preetabli CNSS (mig 325). */
  ebds: (month: number, year: number, file: File) => {
    const form = new FormData();
    form.append('month', String(month));
    form.append('year', String(year));
    form.append('file', file);
    return api.post('/payroll/declarations/ebds', form).then(r => r.data.data);
  },
  /** Ordre de virement groupe : liste (json), fichier banque (csv) ou lettre (pdf). */
  transfer: (month: number, year: number, includeUnpaid: boolean) =>
    api.get('/payroll/transfer', { params: { month, year, includeUnpaid } }).then(r => r.data.data),
  transferFile: (month: number, year: number, includeUnpaid: boolean, format: 'csv' | 'pdf') =>
    api.get('/payroll/transfer', { params: { month, year, includeUnpaid, format }, responseType: 'blob' }),
  /** Attestation de travail / de salaire (salarie en poste). */
  attestation: (employeeId: string, kind: 'travail' | 'salaire') =>
    api.get(`/employees/${employeeId}/attestations/${kind}`, { responseType: 'blob' }),
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

/** Contrats et avenants (lot 4). */
export const contractsApi = {
  list: (employeeId: string) => api.get(`/employees/${employeeId}/contracts`).then(r => r.data.data),
  create: (employeeId: string, data: Record<string, any>) => api.post(`/employees/${employeeId}/contracts`, data).then(r => r.data.data),
  avenant: (employeeId: string, data: Record<string, any>) => api.post(`/employees/${employeeId}/contracts/avenant`, data).then(r => r.data.data),
  /** Renvoie { data, warnings } (avertissements legaux du renouvellement). */
  renew: (employeeId: string, data: { endDate: string; notes?: string | null }) =>
    api.post(`/employees/${employeeId}/contracts/renew`, data).then(r => ({ contract: r.data.data, warnings: (r.data.warnings ?? []) as string[] })),
  renewTrial: (employeeId: string) => api.post(`/employees/${employeeId}/contracts/renew-trial`).then(r => r.data.data),
  end: (employeeId: string, data: { endDate: string; reason: string }) => api.post(`/employees/${employeeId}/contracts/end`, data).then(r => r.data.data),
};

/** Documents du salarie (stockes en base). */
export const employeeDocumentsApi = {
  list: (employeeId: string) => api.get(`/employees/${employeeId}/documents`).then(r => r.data.data),
  upload: (employeeId: string, form: FormData) =>
    api.post(`/employees/${employeeId}/documents`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data.data),
  file: (docId: string) => api.get(`/employees/documents/${docId}/file`, { responseType: 'blob' }),
  remove: (docId: string) => api.delete(`/employees/documents/${docId}`).then(r => r.data.data),
};

/** Depart du salarie : solde de tout compte, recu et certificat (lot 6). */
export const settlementsApi = {
  list: (employeeId: string) => api.get(`/employees/${employeeId}/settlements`).then(r => r.data.data),
  preview: (employeeId: string, data: Record<string, any>) => api.post(`/employees/${employeeId}/settlements/preview`, data).then(r => r.data.data),
  validate: (employeeId: string, data: Record<string, any>) => api.post(`/employees/${employeeId}/settlements`, data).then(r => r.data.data),
  cancel: (id: string) => api.post(`/employees/settlements/${id}/cancel`).then(r => r.data.data),
  receipt: (id: string) => api.get(`/employees/settlements/${id}/receipt`, { responseType: 'blob' }),
  certificate: (id: string) => api.get(`/employees/settlements/${id}/certificate`, { responseType: 'blob' }),
};

/** Espace employe : SES donnees uniquement (lot 8). */
export const selfApi = {
  profile: () => api.get('/employees/me').then(r => r.data.data),
  payslips: () => api.get('/employees/me/payslips').then(r => r.data.data),
  payslipPdf: (id: string) => api.get(`/employees/me/payslips/${id}/pdf`, { responseType: 'blob' }),
  attestation: (kind: 'travail' | 'salaire') => api.get(`/employees/me/attestations/${kind}`, { responseType: 'blob' }),
  leaves: () => api.get('/employees/me/leaves').then(r => r.data.data),
  leaveTypes: () => api.get('/employees/me/leave-types').then(r => r.data.data),
  leavePreview: (params: { type: string; startDate: string; endDate: string }) =>
    api.get('/employees/me/leaves/preview', { params }).then(r => r.data.data),
  requestLeave: (data: Record<string, any>) => api.post('/employees/me/leaves', data).then(r => r.data.data),
  cancelLeave: (id: string) => api.delete(`/employees/me/leaves/${id}`).then(r => r.data.data),
  advances: () => api.get('/employees/me/advances').then(r => r.data.data),
  requestAdvance: (data: Record<string, any>) => api.post('/employees/me/advances', data).then(r => r.data.data),
  cancelAdvanceRequest: (id: string) => api.delete(`/employees/me/advances/${id}`).then(r => r.data.data),
};

/** Demandes d'avance a traiter (gerant). */
export const advanceRequestsApi = {
  list: (status = 'pending') => api.get('/salary-advances/requests', { params: { status } }).then(r => r.data.data),
  approve: (id: string, data: Record<string, any>) => api.post(`/salary-advances/requests/${id}/approve`, data).then(r => r.data.data),
  reject: (id: string, note: string | null) => api.post(`/salary-advances/requests/${id}/reject`, { note }).then(r => r.data.data),
};
