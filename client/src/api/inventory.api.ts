import api from './client';
import { customFieldsApi } from './custom-fields.api';

export const inventoryApi = {
  list: () => api.get('/inventory').then(r => r.data.data),
  alerts: () => api.get('/inventory/alerts').then(r => r.data.data),
  restock: (data: { ingredientId: string; quantity: number; note?: string; supplierLotNumber?: string; expirationDate?: string; manufacturedDate?: string }) => api.post('/inventory/restock', data).then(r => r.data),
  adjust: (data: { ingredientId: string; quantity: number; type: string; note?: string; reasonCode?: string }) => api.post('/inventory/adjust', data),
  updateThreshold: (data: { ingredientId: string; threshold: number }) => api.put('/inventory/threshold', data),
  transactions: (ingredientId?: string) => api.get('/inventory/transactions', { params: { ingredientId } }).then(r => r.data.data),
  /** Consommation matieres par periode (sorties de stock x cout unitaire). */
  consumption: (params: { dateFrom: string; dateTo: string }) =>
    api.get('/inventory/consumption', { params }).then(r => r.data.data),
  /** Achats matieres par periode (entrees de stock : BC + achat direct, prix de reception). */
  purchases: (params: { dateFrom: string; dateTo: string }) =>
    api.get('/inventory/purchases', { params }).then(r => r.data.data),
  /** Age du stock matiere : lots actifs par anciennete (tranches + detail). */
  aging: (): Promise<StockAging> => api.get('/inventory/aging').then(r => r.data.data),
  /** Lignes de fiche technique dont l'unité ne se convertit pas vers l'unité de stock (G0-26). */
  unitConversionIssues: (): Promise<{ source: string; line_id: string; recipe_id: string; recipe_name: string; ingredient_id: string; ingredient_name: string; line_unit: string; stock_unit: string; densite_kg_l: number | null; quantity: number }[]> =>
    api.get('/inventory/unit-conversion-issues').then(r => r.data.data),
  /** Sorties supérieures au stock, tracées (G0-18). */
  anomalies: (status: 'open' | 'resolved'): Promise<StockAnomaly[]> =>
    api.get('/inventory/stock-anomalies', { params: { status } }).then(r => r.data.data),
  resolveAnomaly: (id: string, note: string) =>
    api.post(`/inventory/stock-anomalies/${id}/resolve`, { note }).then(r => r.data.data),
  priceHealth: (): Promise<{
    rows: { ingredient_id: string; name: string; unit: string; catalogue_cost: number | null; lot_avg_cost: number | null; lot_qty: number; lot_value: number; catalogue_value: number; value_gap: number; flag: string; divergence_pct: number | null; used_in_recipe: boolean }[];
    summary: { ecart_prix: number; prix_manquant: number; total_gap: number };
  }> => api.get('/inventory/price-health').then(r => r.data.data),

  /* Cloture de stock par periode (mig 381). */
  /** Stock valorisé à la fin d'une date (G5-01, mig 549). */
  stockAt: (date: string): Promise<{ date: string; total: number; gaps: number; lines: { ingredient_id: string; ingredient_name: string; unit: string; quantity: number; unit_cost: number; value: number }[] }> =>
    api.get('/inventory/stock-at', { params: { date } }).then(r => r.data.data),
  stockAtCsv: (date: string): Promise<Blob> =>
    api.get('/inventory/stock-at', { params: { date, format: 'csv' }, responseType: 'blob' }).then(r => r.data as Blob),
  journalGaps: (): Promise<{ ingredient_id: string; ingredient_name: string; unit: string; current_quantity: number; journal_quantity: number; gap: number }[]> =>
    api.get('/inventory/stock-journal-gaps').then(r => r.data.data),
  closingPreview: (): Promise<StockValuation> => api.get('/inventory/closings/preview').then(r => r.data.data),
  closingList: (): Promise<StockClosing[]> => api.get('/inventory/closings').then(r => r.data.data),
  closingGet: (id: string): Promise<StockClosingDetail> => api.get(`/inventory/closings/${id}`).then(r => r.data.data),
  closingCreate: (data: { periodLabel: string; closingDate: string; notes?: string }): Promise<StockClosingDetail> =>
    api.post('/inventory/closings', data).then(r => r.data.data),
  closingDelete: (id: string) => api.delete(`/inventory/closings/${id}`),
};

export interface StockValuationLine { ingredient_id: string; ingredient_name: string; unit: string; quantity: number; unit_cost: number; value: number }
export interface StockValuation { lines: StockValuationLine[]; total: number; count: number }
export interface StockClosing {
  id: string; period_label: string; closing_date: string; total_value: number; lines_count: number;
  status: 'closed' | 'reopened'; notes: string | null; closed_by_name: string | null; created_at: string;
}
export interface StockClosingDetail extends StockClosing {
  lines: { ingredient_name: string; unit: string | null; quantity: number; unit_cost: number; value: number }[];
}

export interface StockAgingLot {
  id: string; lot_number: string; ingredient_id: string; ingredient_name: string; unit: string;
  quantity_remaining: number; unit_cost: number; value: number;
  received_at: string; expiration_date: string | null; days_in_stock: number; days_to_expiry: number | null;
}
export interface StockAnomaly {
  id: string;
  item_kind: 'ingredient' | 'product' | 'packaging' | 'semi_finished';
  item_id: string; item_name: string | null; unit: string;
  store_name: string | null;
  requested_qty: number; available_qty: number; shortfall_qty: number;
  origin_type: string; origin_id: string | null; label: string | null;
  created_at: string; created_by_name: string | null;
  status: 'open' | 'resolved';
  resolved_at: string | null; resolved_by_name: string | null; resolution_note: string | null;
}

export interface StockAging {
  buckets: { key: string; label: string; lots: number; value: number }[];
  totalValue: number;
  lots: StockAgingLot[];
}

export type LotMovementType = 'open' | 'return' | 'waste' | 'losses' | 'quarantine';
export interface LotMovementPayload {
  type: LotMovementType;
  quantity?: number;
  containerCount?: number;
  reason?: string;
  /** Perte partielle : code du referentiel material_loss_reasons (mig 333). */
  reasonCode?: string;
  note?: string;
}

export const ingredientLotsApi = {
  list: (params?: Record<string, string>) => api.get('/ingredient-lots', { params }).then(r => r.data),
  getById: (id: string) => api.get(`/ingredient-lots/${id}`).then(r => r.data.data),
  expiring: (days: number = 7) => api.get('/ingredient-lots/expiring', { params: { days } }).then(r => r.data.data),
  expired: () => api.get('/ingredient-lots/expired').then(r => r.data.data),
  /** Stock actuel au Pesage (sacs ouverts), agrege par ingredient. Magasinier-only. */
  pesageStock: () => api.get('/ingredient-lots/pesage-stock').then(r => r.data.data),
  expiredActive: () => api.get('/ingredient-lots/expired-active').then(r => r.data.data),
  traceability: (lotId: string) => api.get(`/ingredient-lots/${lotId}/traceability`).then(r => r.data.data),
  productionLots: (planId: string) => api.get(`/ingredient-lots/production/${planId}`).then(r => r.data.data),
  quarantine: (id: string) => api.post(`/ingredient-lots/${id}/quarantine`).then(r => r.data.data),
  /** Déplacement physique vers un emplacement (épic labo L1, mig 424/425). */
  moveLocation: (id: string, toLocationId: string, motif?: string) =>
    api.post(`/ingredient-lots/${id}/move-location`, { toLocationId, motif }).then(r => r.data.data),
  /**
   * Mouvement de lot unique (module Stock) : open (scelle -> entame), return (entame -> scelle),
   * waste (perte partielle en zone entamee), losses (lot entier aux pertes), quarantine.
   */
  movement: (id: string, data: LotMovementPayload) =>
    api.post(`/ingredient-lots/${id}/movement`, data).then(r => r.data.data),
  /** Zone pesage : ouverture a l'avance d'un contenant (economat -> pesage), hors bon de sortie. */
  openToPesage: (id: string, data: { quantity: number; containerCount?: number; reason?: string }) =>
    api.post(`/ingredient-lots/${id}/open-to-pesage`, data).then(r => r.data.data),
  /** Zone pesage : reliquat range en reserve (pesage -> economat, mouvement de zone trace). */
  returnToEconomat: (id: string, quantity: number, reason?: string) =>
    api.post(`/ingredient-lots/${id}/return-to-economat`, { quantity, reason }).then(r => r.data.data),
  /** Zone pesage : perte / casse sur la quantite perdue (sortie d'inventaire 'waste', motif obligatoire). */
  wasteFromPesage: (id: string, quantity: number, reason: string) =>
    api.post(`/ingredient-lots/${id}/pesage-waste`, { quantity, reason }).then(r => r.data.data),
  sendToLosses: (id: string, reason: string, note?: string) =>
    api.post(`/ingredient-lots/${id}/send-to-losses`, { reason, note }).then(r => r.data.data),
  saveQualityCheck: (rvId: string, data: Record<string, any>) => api.post(`/ingredient-lots/quality-check/${rvId}`, data).then(r => r.data.data),
  getQualityCheck: (rvId: string) => api.get(`/ingredient-lots/quality-check/${rvId}`).then(r => r.data.data),
  fefoPreview: (planId: string) => api.get(`/ingredient-lots/production/${planId}/fefo-preview`).then(r => r.data.data),
};

export const ingredientsApi = {
  /** G2-06 — grille des allergènes (missing = seulement les fiches non renseignées) et enregistrement d'une ligne. */
  allergenGrid: (missing = false): Promise<AllergenGridRow[]> =>
    api.get('/ingredients/allergen-grid', { params: missing ? { missing: 1 } : {} }).then(r => r.data.data),
  saveAllergens: (id: string, data: { contains: string[]; traces: string[] }): Promise<AllergenGridRow> =>
    api.put(`/ingredients/${id}/allergens`, data).then(r => r.data.data),
  /** G2-04 — prix à revoir (avec dernières réceptions et proposition), correction tracée, journal. */
  costSuspects: (): Promise<PriceSuspect[]> => api.get('/inventory/cost-corrections/suspects').then(r => r.data.data),
  correctCost: (ingredientId: string, newCost: number, reason: string): Promise<{ id: string; oldCost: number; newCost: number }> =>
    api.post('/inventory/cost-corrections', { ingredientId, newCost, reason }).then(r => r.data.data),
  costCorrections: (): Promise<CostCorrection[]> => api.get('/inventory/cost-corrections').then(r => r.data.data),
  /** G2-03 — fusion de deux fiches : aperçu de l'impact, fusion (tout ou rien), journal. */
  mergePreview: (sourceId: string, targetId: string): Promise<IngredientMergePreview> =>
    api.post('/inventory/ingredient-merges/preview', { sourceId, targetId }).then(r => r.data.data),
  merge: (sourceId: string, targetId: string): Promise<{ mergeId: string; impact: IngredientMergeImpact }> =>
    api.post('/inventory/ingredient-merges', { sourceId, targetId }).then(r => r.data.data),
  mergeHistory: (): Promise<IngredientMergeEntry[]> => api.get('/inventory/ingredient-merges').then(r => r.data.data),
  list: () => api.get('/ingredients').then(r => r.data.data),
  getById: (id: string) => api.get(`/ingredients/${id}`).then(r => r.data.data),
  // Champs personnalisés (mig 369) : __cf / __cfEntity retirés du corps et enregistrés après la fiche.
  create: async (data: Record<string, any>) => {
    const { __cf, __cfEntity, ...rest } = data;
    const created = await api.post('/ingredients', rest).then(r => r.data.data);
    if (__cf && created?.id) await customFieldsApi.save(__cfEntity ?? 'ingredient', created.id, __cf);
    return created;
  },
  update: async (id: string, data: Record<string, any>) => {
    const { __cf, __cfEntity, ...rest } = data;
    const updated = await api.put(`/ingredients/${id}`, rest).then(r => r.data.data);
    if (__cf) await customFieldsApi.save(__cfEntity ?? 'ingredient', id, __cf);
    return updated;
  },
  remove: (id: string, opts: { force?: boolean } = {}) =>
    api.delete(`/ingredients/${id}`, { params: opts.force ? { force: 'true' } : undefined }),
  /** Convertit un ingredient mal range en consommable (packaging_items). */
  convertToConsumable: (id: string, categoryId: string) =>
    api.post(`/ingredients/${id}/convert-to-consumable`, { categoryId }).then(r => r.data.data),
  /** Import xlsx — phase 1 : analyse + plan (creations/maj/inchanges) */
  importPreview: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/ingredients/import/preview', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data.data);
  },
  /** Import xlsx — phase 2 : applique creations + mises a jour */
  importCommit: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post('/ingredients/import/commit', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data.data);
  },
  /** Telecharge le xlsx export (declenche un download navigateur) */
  exportXlsx: async (filename = 'ingredients-economat.xlsx') => {
    const resp = await api.get('/ingredients/export', { responseType: 'blob' });
    const url = URL.createObjectURL(resp.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  /** Telecharge un modele xlsx vide (en-tete + ligne d'exemple) */
  downloadTemplate: async () => {
    const resp = await api.get('/ingredients/import/template', { responseType: 'blob' });
    const url = URL.createObjectURL(resp.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ingredients-modele-import.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

export type IngredientMergeImpact = {
  tables: Record<string, number>; recipes: number; lots: number; purchaseOrders: number;
  stock: { storeId: string; storeName: string; source: number; target: number }[];
  unitCostBefore: number; unitCostAfter: number;
};
type MergeSide = { id: string; name: string; unit: string; unit_cost: string | null };
export type IngredientMergePreview = { source: MergeSide; target: MergeSide; blocker: string | null; impact: IngredientMergeImpact };
export type IngredientMergeEntry = {
  id: string; source_name: string; target_id: string; target_name: string; impact: IngredientMergeImpact;
  unit_cost_before: string | null; unit_cost_after: string | null; merged_at: string; merged_by_name: string | null;
};

export type PriceSuspect = {
  ingredientId: string; name: string; unit: string; category: string | null; unitCost: number; median: number | null;
  reason: 'sans_prix' | 'aberrant'; usedInRecipes: number;
  receptions: { date: string; voucher: string; quantity: number; unitPrice: number }[];
  proposal: number | null;
};
export type CostCorrection = {
  id: string; ingredient_id: string; ingredient_name: string; unit: string; old_cost: number; new_cost: number;
  reason: string; corrected_at: string; corrected_by_name: string | null;
};

export type AllergenGridRow = {
  id: string; name: string; category: string | null; contains: string[]; traces: string[]; reviewed: boolean;
  reviewedAt: string | null; reviewedByName: string | null; proposal: string[]; usedInRecipes: number;
};
