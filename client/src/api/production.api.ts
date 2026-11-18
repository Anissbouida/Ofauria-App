import { useQuery } from '@tanstack/react-query';
import api from './client';
import type { ProductionPlanEvent, ProductionPrintDoc, ResolvedPrintTemplate } from '@ofauria/shared';

/** Réglage enregistré d'un gabarit d'impression (M8-04) ; null = hérité. */
export interface PrintTemplateRow {
  doc_type: ProductionPrintDoc; label?: string; title: string | null;
  layout: { columns?: string[]; signatures?: string[] }; footer_note: string | null; updated_at?: string; updated_by_name?: string;
}
/** Synthèse de l'ordre (M8-05) : quantités, rendement, pertes et coût par pièce calculés au serveur. */
export interface PlanSummary {
  quantities: { planned: number; done: number; donePct: number; activeItems: number; producedItems: number };
  yield: { average: number | null; recorded: number; missing: number; threshold: number | null; belowThreshold: boolean; lossesTotal: number; toFridgeTotal: number };
  cost: { total: number | null; perUnit: number | null; unitBase: number; variancePct: number | null };
}
/** Éléments masqués pour un ordre : réglages société ∪ réglages de son type (mig 591). */
export function useScreenHidden(orderTypeId: string | null | undefined): Set<string> {
  const { data = [] } = useQuery({ queryKey: ['production-screen-settings'], queryFn: productionApi.screenSettings, staleTime: 60_000 });
  return new Set(data.filter(h => h.orderTypeId === null || h.orderTypeId === orderTypeId).map(h => h.key));
}
/** Clé partagée : invalider ['production', id] la rafraîchit aussi. */
export const planSummaryKey = (id: string) => ['production', id, 'summary'] as const;
export function usePlanSummary(id: string | undefined, enabled = true) {
  return useQuery({ queryKey: planSummaryKey(id ?? ''), queryFn: () => productionApi.summary(id!), enabled: !!id && enabled, staleTime: 30_000 });
}
export interface PrintTemplateInput { title?: string | null; columns?: string[] | null; signatures?: string[] | null; footer?: string | null }

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
  /** Plan directeur enregistré (G5-05). */
  masterSchedule: (from: string, weeks = 8): Promise<{ weeks: string[]; rows: { product_id: string; product_name: string; category_name: string | null; weeks: Record<string, { forecast: number; planned: number | null }> }[] }> =>
    api.get('/production/master-schedule', { params: { from, weeks } }).then(r => r.data.data),
  saveMasterSchedule: (entries: { productId: string; weekStart: string; quantity: number | null }[]): Promise<{ saved: number; cleared: number }> =>
    api.put('/production/master-schedule', { entries }).then(r => r.data.data),
  /** Calcul des besoins phasé (G5-04). */
  mrpPhased: (from: string): Promise<MrpPhased> => api.get('/production/mrp/phased', { params: { from } }).then(r => r.data.data),
  mrpPhasedValidate: (picks: { kind: 'product' | 'ingredient'; id: string; qty: number; unit: string; releaseDate: string; needDate: string }[]): Promise<{ plans: string[]; requests: number }> =>
    api.post('/production/mrp/phased/validate', { picks }).then(r => r.data.data),
  /** Types d'ordre de fabrication (M2-01). */
  orderTypes: (activeOnly = false): Promise<ProductionOrderType[]> =>
    api.get('/production/order-types', { params: activeOnly ? { active: '1' } : {} }).then(r => r.data.data),
  createOrderType: (data: ProductionOrderTypeInput & { code: string; label: string }): Promise<ProductionOrderType> =>
    api.post('/production/order-types', data).then(r => r.data.data),
  updateOrderType: (id: string, data: ProductionOrderTypeInput): Promise<ProductionOrderType> =>
    api.put(`/production/order-types/${id}`, data).then(r => r.data.data),
  /** Écrans de fabrication (mig 591) : éléments masqués (société = orderTypeId null). */
  screenSettings: (): Promise<{ orderTypeId: string | null; key: string }[]> =>
    api.get('/production/screen-settings').then(r => r.data.data),
  setScreenSetting: (orderTypeId: string | null, key: string, hidden: boolean): Promise<{ orderTypeId: string | null; key: string }[]> =>
    api.put('/production/screen-settings', { orderTypeId, key, hidden }).then(r => r.data.data),
  /** Aperçu d'impact (C-09) : ordres ouverts touchés par un type d'ordre ou une politique. */
  orderTypeImpact: (id: string): Promise<{ draft: number; underway: number }> =>
    api.get(`/production/order-types/${id}/impact`).then(r => r.data.data),
  policyImpact: (scopeType: string, scopeId: string): Promise<{ draft: number; underway: number }> =>
    api.get('/production/policies/impact', { params: { scopeType, scopeId } }).then(r => r.data.data),
  /** Synthèse chiffrée de l'ordre, calculée au serveur (M8-05). */
  summary: (id: string): Promise<PlanSummary> => api.get(`/production/${id}/summary`).then(r => r.data.data),
  /** Gabarits d'impression résolus pour un type d'ordre (M8-04). */
  printTemplates: (orderTypeId?: string | null): Promise<Record<ProductionPrintDoc, ResolvedPrintTemplate>> =>
    api.get('/production/print-templates', { params: orderTypeId ? { orderTypeId } : {} }).then(r => r.data.data),
  printTemplateSettings: (): Promise<{ base: PrintTemplateRow[]; variants: (PrintTemplateRow & { order_type_id: string; order_type_label: string })[] }> =>
    api.get('/production/print-templates/settings').then(r => r.data.data),
  updatePrintTemplate: (docType: ProductionPrintDoc, data: PrintTemplateInput, orderTypeId?: string | null) =>
    api.put(orderTypeId ? `/production/print-templates/${docType}/variants/${orderTypeId}` : `/production/print-templates/${docType}`, data).then(r => r.data.data),
  deletePrintTemplateVariant: (docType: ProductionPrintDoc, orderTypeId: string) =>
    api.delete(`/production/print-templates/${docType}/variants/${orderTypeId}`).then(r => r.data.data),
  /** Priorité et fenêtre planifiée d'un ordre (M2-02). */
  updateHeader: (id: string, data: { priority?: number; plannedStart?: string | null; plannedEnd?: string | null }) =>
    api.put(`/production/${id}/header`, data).then(r => r.data.data),
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
  levels: { stores: { id: string; label: string }[]; workshops: { id: string; label: string }[]; orderTypes?: { id: string; label: string }[] };
};

/** Type d'ordre de fabrication (M2-01, mig 546). */
export interface ProductionOrderType {
  id: string;
  code: string;
  label: string;
  description: string | null;
  requires_bon_sortie: boolean;
  requires_weighing: boolean;
  requires_quality_check: boolean;
  /** Sous-traité (M9, mig 584). */
  is_subcontracting?: boolean;
  consumption_mode: 'au_bon_de_sortie' | 'a_la_declaration' | 'manuel';
  default_target_role: string | null;
  is_default: boolean;
  is_active: boolean;
  display_order: number;
  plan_count?: number;
}
export interface ProductionOrderTypeInput {
  code?: string;
  label?: string;
  description?: string | null;
  requiresBonSortie?: boolean;
  requiresWeighing?: boolean;
  requiresQualityCheck?: boolean;
  isSubcontracting?: boolean;
  consumptionMode?: ProductionOrderType['consumption_mode'];
  defaultTargetRole?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
  displayOrder?: number;
}
export const CONSUMPTION_MODE_LABELS: Record<ProductionOrderType['consumption_mode'], string> = {
  au_bon_de_sortie: 'Au bon de sortie',
  a_la_declaration: 'À la déclaration',
  manuel: 'Manuelle',
};
/** Priorité d'un ordre : 1 = urgente … 5 = basse (3 par défaut). */
export const PRIORITY_LABELS: Record<number, string> = { 1: 'Urgente', 2: 'Haute', 3: 'Normale', 4: 'Basse', 5: 'Très basse' };

/** Types d'ordre actifs (sélecteur de création). */
export function useOrderTypes(activeOnly = true) {
  const { data, isLoading } = useQuery({ queryKey: ['production-order-types', activeOnly], queryFn: () => productionApi.orderTypes(activeOnly), staleTime: 60_000 });
  return { types: data ?? [], isLoading };
}

/** Calcul des besoins phasé (G5-04). */
export interface MrpPhasedProposal {
  key: string; kind: 'product' | 'base' | 'ingredient'; id: string; name: string; unit: string;
  qty: number; needDate: string; releaseDate: string; late: boolean;
}
export interface MrpPhased {
  days: string[];
  params: { horizon_days: number; product_lead_days: number; base_lead_days: number; default_purchase_lead_days: number };
  items: { key: string; kind: 'product' | 'base' | 'ingredient'; id: string; name: string; unit: string; level: number; onHand: number; safety: number; leadDays: number;
    days: { date: string; gross: number; receipts: number; planned: number; projected: number }[] }[];
  proposals: MrpPhasedProposal[];
  messages: { key: string; name: string; ref: string; date: string; qty: number; action: 'avancer' | 'retarder' | 'annuler'; newDate: string | null }[];
}
