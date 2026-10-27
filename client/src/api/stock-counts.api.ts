import api from './client';

/** Inventaire physique (mig 367). */
export type StockCountStatus = 'counting' | 'review' | 'validated' | 'cancelled';
export type StockCountLine = {
  id: string; item_kind: 'ingredient' | 'packaging'; ingredient_id: string | null; packaging_id: string | null; item_name: string; unit: string | null;
  category_id: string | null; category_name: string | null; container_size: string | null;
  theoretical_at_start: string | null; theoretical_at_count: string | null; counted_qty: string | null;
  counted_by_name: string | null; counted_at: string | null; note: string | null; cost: string | null;
  applied_qty: string | null; applied_value: string | null;
};
export type StockCount = {
  id: string; number: string; title: string | null; scope: 'full' | 'partial'; item_kinds: 'ingredient' | 'packaging' | 'both'; blind: boolean;
  status: StockCountStatus; count_date: string; notes: string | null; zero_uncounted: boolean; lines_total: number; lines_counted: number;
  gap_value: string | null; gain_value: string | null; loss_value: string | null;
  created_by_name: string | null; submitted_by_name?: string | null; submitted_at?: string | null; validated_by_name: string | null; validated_at: string | null;
  created_at: string; theoretical_hidden?: boolean; lines?: StockCountLine[];
};

export const STOCK_COUNT_STATUS_LABELS: Record<StockCountStatus, string> = { counting: 'Comptage en cours', review: 'À valider', validated: 'Validé', cancelled: 'Annulé' };
export const STOCK_COUNT_STATUS_TAG: Record<StockCountStatus, string> = { counting: 'odoo-tag-blue', review: 'odoo-tag-orange', validated: 'odoo-tag-green', cancelled: 'odoo-tag-grey' };

export const stockCountsApi = {
  list: (params: Record<string, string> = {}): Promise<{ data: StockCount[]; total: number }> => api.get('/stock-counts', { params }).then(r => ({ data: r.data.data, total: r.data.total })),
  get: (id: string): Promise<StockCount> => api.get(`/stock-counts/${id}`).then(r => r.data.data),
  create: (data: { title?: string | null; itemKinds: 'ingredient' | 'packaging' | 'both'; categoryIds?: string[]; blind: boolean; includeInactive?: boolean; notes?: string | null }): Promise<StockCount> =>
    api.post('/stock-counts', data).then(r => r.data.data),
  count: (id: string, lineId: string, countedQty: number | null, note?: string | null): Promise<StockCountLine> =>
    api.put(`/stock-counts/${id}/lines/${lineId}`, { countedQty, note }).then(r => r.data.data),
  addLine: (id: string, data: { ingredientId?: string; packagingId?: string }) => api.post(`/stock-counts/${id}/lines`, data).then(r => r.data.data),
  action: (id: string, action: 'submit' | 'reopen' | 'cancel'): Promise<StockCount> => api.post(`/stock-counts/${id}/${action}`).then(r => r.data.data),
  validate: (id: string, zeroUncounted: boolean): Promise<StockCount> => api.post(`/stock-counts/${id}/validate`, { zeroUncounted }).then(r => r.data.data),
  sheet: (id: string) => api.get(`/stock-counts/${id}/sheet`, { responseType: 'blob' }).then(r => r.data as Blob),
};

/**
 * Quantité saisie au comptage : nombre, ou petite formule de comptage par contenants
 * (« 3x25 + 4,5 », « 2*12 »). Renvoie null si la saisie n'est pas lisible.
 */
export function parseCountExpression(raw: string): number | null {
  const s = raw.trim().replace(/,/g, '.').replace(/[x×]/gi, '*').replace(/\s+/g, '');
  if (!s) return null;
  if (!/^[0-9.*+]+$/.test(s)) return null;
  let total = 0;
  for (const term of s.split('+')) {
    if (!term) return null;
    let prod = 1;
    for (const f of term.split('*')) {
      if (!/^\d+(\.\d+)?$|^\.\d+$/.test(f)) return null;
      prod *= Number(f);
    }
    total += prod;
  }
  return Math.round(total * 1000) / 1000;
}
