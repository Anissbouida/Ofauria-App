import { useQuery } from '@tanstack/react-query';
import api from './client';
import type { ProductionPlanEvent } from '@ofauria/shared';

/** Atelier de production (mig 511) : son code est le target_role des plans. */
export interface Workshop {
  code: string;
  label: string;
  workCenterId: string | null;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  categoryIds: number[];
  categorySlugs: string[];
  memberRoles: string[];
  memberUsers: string[];
}

export type WorkshopInput = Omit<Workshop, 'code' | 'categorySlugs'>;

/** Entrée d'un référentiel du procédé (mig 513) : types d'étape, d'équipement, paramètres. */
export interface ProcessRefEntry { code: string; label: string; color: string | null; isActive: boolean; metadata: Record<string, unknown> }

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
export type SemiFinishedNeed = { recipe_id: string; name: string; unit: string; /** Niveau dans la nomenclature (1 = base directe du produit), G0-27. */ level?: number; needed: number; from_stock: number; to_produce: number };

// Réglages de production centralisés (mig 403) — roadmap lot 9
export interface ProductionSettings {
  production_charges_fixes_pct: number;
  production_overproduction_pct: number;
  production_markup_percent: number;
  production_steps_enabled: boolean;
  production_steps_blocking: boolean;
  production_yield_enabled: boolean;
  production_cost_enabled: boolean;
}
export interface ProductionSettingsInput {
  chargesFixesPct: number;
  overproductionPct: number;
  markupPercent: number;
  stepsEnabled: boolean;
  stepsBlocking: boolean;
  yieldEnabled: boolean;
  costEnabled: boolean;
}

export const productionApi = {
  /** Ateliers (mig 511) et ceux de l'utilisateur connecté. */
  workshops: (): Promise<{ workshops: Workshop[]; mine: string[] }> =>
    api.get('/production/workshops').then(r => r.data.data),
  saveWorkshop: (code: string, data: WorkshopInput): Promise<{ workshops: Workshop[] }> =>
    api.put(`/production/workshops/${code}`, data).then(r => r.data.data),
  /** Référentiels du procédé (mig 513), éditables dans Paramètres › Référentiels. */
  processReferentials: (): Promise<{ stepTypes: ProcessRefEntry[]; equipmentTypes: ProcessRefEntry[]; readingParams: ProcessRefEntry[] }> =>
    api.get('/production/process-referentials').then(r => r.data.data),
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
  /** MRP — besoins matière (achats) du jour : manquants vs stock — roadmap lot 8. */
  mrpMaterialRequirements: (date: string, store?: string): Promise<{
    rows: { ingredient_id: string; ingredient_name: string; unit: string; needed: number; on_hand: number; seuil: number; shortage: number; unit_cost: number; estimated_cost: number }[];
    totals: { ingredients: number; to_order: number; estimated_cost: number };
  }> =>
    api.get('/production/mrp/material-requirements', { params: { date, ...(store ? { store } : {}) } }).then(r => r.data.data),
  mrpGeneratePurchaseRequests: (date: string, store?: string): Promise<{ created: number; skipped_existing: number; candidates: number }> =>
    api.post('/production/mrp/generate-purchase-requests', { date, ...(store ? { store } : {}) }).then(r => r.data.data),
  /** Politiques de production (M1-03 / M1-04) : valeurs effectives pour un contexte et valeurs posées. */
  listPolicies: (ctx: { store?: string; workshop?: string; orderType?: string; product?: string; exact?: '1' } = {}): Promise<ProductionPolicies> =>
    api.get('/production/policies', { params: Object.fromEntries(Object.entries(ctx).filter(([, v]) => v)) }).then(r => r.data.data),
  /** Pose (value = champs) ou retire (value = null) une politique à un niveau. */
  setPolicy: (key: string, scopeType: PolicyScopeType, scopeId: string, value: Record<string, unknown> | null) =>
    api.put(`/production/policies/${encodeURIComponent(key)}`, { scopeType, scopeId, value }).then(r => r.data.data),
  /** Réglages de production centralisés — roadmap lot 9. */
  getSettings: (): Promise<ProductionSettings> => api.get('/production/settings').then(r => r.data.data),
  updateSettings: (data: Partial<ProductionSettingsInput>): Promise<ProductionSettings> =>
    api.put('/production/settings', data).then(r => r.data.data),
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
  /** G0-24 : `extra` porte les saisies du lancement (observations, bases, pertes), enregistrées
   *  avec la déclaration dans une seule transaction côté serveur. */
  produceItems: (id: string, items: { planItemId: string; actualQuantity: number; outputs?: { productId?: string | null; equivPieces?: number; quantity: number }[] }[], producedAt?: string,
    extra?: {
      observations?: string;
      bases?: { subRecipeId: string; actualQuantity: number; alreadyProduced?: boolean }[];
      losses?: { planItemId: string; quantity: number; reason: string; reasonNote?: string }[];
    }) =>
    api.post(`/production/${id}/produce-items`, { items, producedAt, ...extra }).then(r => r.data),
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

/**
 * Ateliers de production (mig 511) : remplace les listes de rôles chefs codées en dur.
 * `mine` = ateliers de l'utilisateur ; label(code) / slugsOf(code) pour l'affichage et
 * le filtrage des produits d'un atelier.
 */
export function useWorkshops() {
  const { data, isLoading } = useQuery({ queryKey: ['production-workshops'], queryFn: productionApi.workshops, staleTime: 60_000 });
  const all = data?.workshops ?? [];
  return {
    all,
    workshops: all.filter(w => w.isActive),
    mine: data?.mine ?? [],
    isLoading,
    label: (code?: string | null) => (code ? all.find(w => w.code === code)?.label ?? code : ''),
    slugsOf: (code?: string | null) => (code ? all.find(w => w.code === code)?.categorySlugs ?? null : null),
  };
}

/**
 * Référentiels du procédé (mig 513) : remplacent les listes de types d'étape, de
 * paramètres de relevé et de types CCP codées en dur dans les écrans.
 */
export function useProcessRefs() {
  const { data } = useQuery({ queryKey: ['process-referentials'], queryFn: productionApi.processReferentials, staleTime: 60_000 });
  const steps = data?.stepTypes ?? [];
  const params = data?.readingParams ?? [];
  const step = (code?: string | null) => steps.find(s => s.code === code);
  return {
    stepTypes: steps.filter(s => s.isActive),
    readingParams: params.filter(p => p.isActive),
    equipmentTypes: (data?.equipmentTypes ?? []).filter(e => e.isActive),
    stepLabel: (code?: string | null) => (code ? step(code)?.label ?? code : ''),
    stepColor: (code?: string | null) => step(code)?.color ?? step('autre')?.color ?? '#9ca3af',
    isCcp: (code?: string | null) => step(code)?.metadata.ccp === true,
    /** Paramètre proposé pour un relevé sur ce type d'étape (sinon le premier actif). */
    defaultParam: (code?: string | null) => {
      const p = step(code)?.metadata.default_param;
      return typeof p === 'string' ? p : (params.find(x => x.isActive)?.code ?? '');
    },
    paramMeta: (code: string) => {
      const p = params.find(x => x.code === code);
      return { label: p?.label ?? code, unit: typeof p?.metadata.unit === 'string' ? p.metadata.unit : '' };
    },
  };
}

export type PolicyScopeType = 'company' | 'store' | 'workshop' | 'order_type' | 'product';
export type PolicyField = { name: string; label: string; type: 'boolean' | 'number' | 'integer' | 'percent' | 'enum' | 'list' | 'date' | 'time'; unit?: string; min?: number; max?: number; options?: { value: string; label: string }[] };
export type ProductionPolicy = {
  key: string; label: string; help: string; fields: PolicyField[]; defaults: Record<string, unknown>;
  scopes: PolicyScopeType[]; companyManagedElsewhere: boolean;
  effective: { value: Record<string, unknown>; source: PolicyScopeType | 'default'; scopeId: string; sourceLabel: string; scopeLabel: string };
  company: { value: Record<string, unknown>; source: PolicyScopeType | 'default' };
  overrides: { scopeType: PolicyScopeType; scopeId: string; scopeTypeLabel: string; scopeLabel: string; value: Record<string, unknown> }[];
};
export type ProductionPolicies = {
  policies: ProductionPolicy[];
  levels: { stores: { id: string; label: string }[]; workshops: { id: string; label: string }[] };
};
