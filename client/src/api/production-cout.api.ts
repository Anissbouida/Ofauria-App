import api from './client';

export const productionCoutApi = {
  // Equipements
  listEquipements: (storeId?: string) =>
    api.get('/production-cout/equipements', { params: { storeId } }).then(r => r.data.data),
  getEquipement: (id: string) =>
    api.get(`/production-cout/equipements/${id}`).then(r => r.data.data),
  createEquipement: (data: Record<string, unknown>) =>
    api.post('/production-cout/equipements', data).then(r => r.data.data),
  updateEquipement: (id: string, data: Record<string, unknown>) =>
    api.put(`/production-cout/equipements/${id}`, data).then(r => r.data.data),

  // Temps de travail
  getTempsTravail: (planId: string) =>
    api.get(`/production-cout/plans/${planId}/temps-travail`).then(r => r.data.data),
  recordTempsTravail: (planId: string, data: {
    employee_id: string; debut: string; fin?: string; duree_minutes?: number;
    plan_item_id?: string; notes?: string;
  }) =>
    api.post(`/production-cout/plans/${planId}/temps-travail`, data).then(r => r.data.data),

  // Equipement usage
  getEquipementUsage: (planId: string) =>
    api.get(`/production-cout/plans/${planId}/equipement-usage`).then(r => r.data.data),
  recordEquipementUsage: (planId: string, data: {
    equipement_id: string; debut: string; fin?: string; duree_minutes?: number; notes?: string;
  }) =>
    api.post(`/production-cout/plans/${planId}/equipement-usage`, data).then(r => r.data.data),

  // Cost
  calculateCost: (planId: string) =>
    api.post(`/production-cout/plans/${planId}/calculate`).then(r => r.data.data),
  getCost: (planId: string) =>
    api.get(`/production-cout/plans/${planId}/cout`).then(r => r.data.data),

  // Dashboard
  costStats: (storeId: string, dateFrom?: string, dateTo?: string) =>
    api.get('/production-cout/stats', { params: { storeId, dateFrom, dateTo } }).then(r => r.data.data),
  costByDay: (storeId: string, dateFrom: string, dateTo: string) =>
    api.get('/production-cout/by-day', { params: { storeId, dateFrom, dateTo } }).then(r => r.data.data),
};
