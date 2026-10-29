import api from './client';
import type { ProductionPlanEvent } from '@ofauria/shared';

export type MrpRow = {
  product_id: string; product_name: string; category_id: number | null; category_name: string | null;
  forecast_qty: number; order_qty: number; demand: number; on_hand: number; planned_qty: number; net_to_produce: number;
};
export type MrpResult = {
  store_id: string; date: string; rows: MrpRow[];
  totals: { demand: number; on_hand: number; planned_qty: number; net_to_produce: number };
};
export type MrpHorizonRow = {
  product_id: string; product_name: string; category_name: string | null;
  days: Record<string, { demand: number; net: number }>; total_net: number;
};
export type MrpHorizon = { store_id: string; dates: string[]; rows: MrpHorizonRow[]; totals_by_date: Record<string, number> };
export type SemiFinishedNeed = { recipe_id: string; name: string; unit: string; needed: number; from_stock: number; to_produce: number };

export const productionApi = {
  list: (params?: Record<string, string>) => api.get('/production', { params }).then(r => r.data),
  /** MRP — besoins nets de production du jour (plan directeur). */
  mrp: (date: string, store?: string): Promise<MrpResult> =>
    api.get('/production/mrp', { params: { date, ...(store ? { store } : {}) } }).then(r => r.data.data),
  /** MRP — génère les plans de production depuis les besoins nets. */
  mrpGenerate: (date: string, store?: string): Promise<{ plans: { plan_id: string; target_role: string | null; atelier_label: string; item_count: number }[]; nothingToProduce: boolean }> =>
    api.post('/production/mrp/generate', { date, ...(store ? { store } : {}) }).then(r => r.data.data),
  /** MRP — besoins nets par jour sur un horizon (vue semaine). */
  mrpHorizon: (from: string, to: string, store?: string): Promise<MrpHorizon> =>
    api.get('/production/mrp/horizon', { params: { from, to, ...(store ? { store } : {}) } }).then(r => r.data.data),
  /** MRP — besoins semi-finis nets du jour (lecture seule). */
  mrpSemiFinished: (date: string, store?: string): Promise<{ date: string; rows: SemiFinishedNeed[] }> =>
    api.get('/production/mrp/semi-finished', { params: { date, ...(store ? { store } : {}) } }).then(r => r.data.data),
  getById: (id: string) => api.get(`/production/${id}`).then(r => r.data.data),
  create: (data: Record<string, any>) => api.post('/production', data).then(r => r.data.data),
  confirm: (id: string) => api.post(`/production/${id}/confirm`).then(r => r.data),
  /** Repasse un plan confirme -> draft pour permettre des modifications.
   *  Refuse si un item a deja demarre ou si le BSI a ete preleve. */
  revertToDraft: (id: string) => api.post(`/production/${id}/revert-to-draft`).then(r => r.data.data),
  /** Relance un plan bloque : reactive les articles annules / en attente, re-verifie
   *  la dispo ingredient et repositionne le plan. itemIds omis = tous les relancables. */
  relaunch: (id: string, itemIds?: string[]) =>
    api.post(`/production/${id}/relaunch`, itemIds ? { itemIds } : {}).then(r => r.data),
  start: (id: string) => api.post(`/production/${id}/start`).then(r => r.data.data),
  startItems: (id: string, itemIds: string[], startedAt?: string) =>
    api.post(`/production/${id}/start-items`, { itemIds, startedAt }).then(r => r.data),
  produceItems: (id: string, items: { planItemId: string; actualQuantity: number; outputs?: { productId?: string | null; equivPieces?: number; quantity: number }[] }[], producedAt?: string) =>
    api.post(`/production/${id}/produce-items`, { items, producedAt }).then(r => r.data),
  pendingTransfers: () => api.get('/production/transfers/pending').then(r => r.data.data),
  confirmTransferReception: (transferId: string, items: { itemId: string; qtyReceived: number; notes?: string }[]) =>
    api.post(`/production/transfers/${transferId}/receive`, { items }).then(r => r.data),
  restoreItems: (id: string, itemIds: string[]) =>
    api.post(`/production/${id}/restore-items`, { itemIds }).then(r => r.data),
  requestStockVerification: (id: string, ingredientId: string, note?: string) =>
    api.post(`/production/${id}/needs/${ingredientId}/request-verification`, { note }).then(r => r.data.data),
  cancelItems: (id: string, itemIds: string[], reason?: string) =>
    api.post(`/production/${id}/cancel-items`, { itemIds, reason }).then(r => r.data),
  complete: (id: string, items: { planItemId: string; actualQuantity: number }[], completionType?: string) =>
    api.post(`/production/${id}/complete`, { items, completionType }).then(r => r.data),
  analyzeSubRecipes: (id: string) => api.get(`/production/${id}/sub-recipe-analysis`).then(r => r.data.data),
  detectSemiFinished: (id: string) => api.post(`/production/${id}/detect-semi-finished`).then(r => r.data),
  remove: (id: string) => api.delete(`/production/${id}`),
  // Journal des transitions plan + bons (mig 299)
  getEvents: (id: string): Promise<ProductionPlanEvent[]> =>
    api.get(`/production/${id}/events`).then(r => r.data.data),

  getActivities: (id: string) => api.get(`/production/${id}/activities`).then(r => r.data.data),
  addActivity: (id: string, message: string) => api.post(`/production/${id}/activities`, { message }).then(r => r.data.data),
};
