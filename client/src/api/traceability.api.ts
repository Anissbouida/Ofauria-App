import api from './client';

/** Traçabilité aval / amont et rappel produit (mig 316). */

export type Certainty = 'certain' | 'possible';
export type RecallStatus = 'open' | 'blocked' | 'closed';
export type Disposition = 'detruit' | 'retourne_fournisseur' | 'libere' | 'deja_consomme';

export type SearchHit = {
  id: string; kind: 'ingredient_lot' | 'product_lot'; lot_number: string; supplier_lot_number: string | null;
  item_name: string; supplier_name: string | null; received_at: string | null; expiration_date: string | null; status: string;
};

export type ProductLotTrace = {
  id: string; lot_number: string; product_id: string; product_name: string; store_id: string; store_name: string | null;
  production_plan_id: string | null; plan_item_id: string | null; produced_at: string; expires_at: string | null; status: string;
  quantity_total: number; sold_qty: number; wasted_qty: number; recycled_qty: number; remaining_qty: number;
  sales_count: number; first_sale_at: string | null; last_sale_at: string | null; sale_qty_traced: number; certainty?: Certainty;
};

export type ForwardTrace = {
  lot: {
    id: string; lot_number: string; supplier_lot_number: string | null; ingredient_name: string; unit: string | null;
    supplier_name: string | null; received_at: string | null; expiration_date: string | null; status: string;
    quantity_received: number; quantity_remaining: number; voucher_number: string | null;
  };
  plans: Array<{ id: string; plan_date: string; status: string; store_name: string | null; qty_used: number | null; depth: number }>;
  items: Array<{ id: string; plan_id: string; product_name: string | null; planned_quantity: number; actual_quantity: number | null; certainty: Certainty }>;
  semiLots: Array<{ id: string; lot_number: string; recipe_name: string; quantity_produced: number; quantity_remaining: number; unit: string; status: string; depth: number }>;
  productLots: ProductLotTrace[];
  byStore: Array<{ store_name: string; lots: number; sold: number; remaining: number; wasted: number }>;
  traceStart: string | null;
};

export type BackwardTrace = {
  lot: ProductLotTrace;
  ingredientLots: Array<{
    id: string; lot_number: string; supplier_lot_number: string | null; ingredient_name: string; unit: string | null;
    supplier_name: string | null; expiration_date: string | null; status: string; qty_used: number; depth: number; certainty: Certainty;
  }>;
};

export type LotSale = { created_at: string; quantity: number; sale_id: string | null; sale_number: string | null; total: number | null; customer_name: string | null; customer_phone: string | null };

export type Recall = {
  id: string; reference: string; origin_kind: 'ingredient_lot' | 'product_lot'; origin_id: string; origin_label: string; reason: string;
  status: RecallStatus; created_at: string; created_by_name: string | null; blocked_at: string | null; blocked_by_name?: string | null;
  closed_at: string | null; closed_by_name?: string | null; closing_note: string | null; items_count?: number;
};

export type RecallItem = {
  id: string; item_kind: 'ingredient_lot' | 'product_lot' | 'semi_finished_lot'; lot_id: string; label: string; lot_number: string | null;
  store_name: string | null; certainty: Certainty; qty_total: number | null; qty_sold: number | null; qty_remaining: number | null; unit: string | null;
  previous_status: string | null; current_remaining: number | null; current_status: string | null; sales_count: number | null;
  disposition: Disposition | null; disposition_note: string | null;
};

export const DISPOSITION_LABELS: Record<Disposition, string> = {
  detruit: 'Détruit',
  retourne_fournisseur: 'Retourné au fournisseur',
  libere: 'Libéré (analyse conforme)',
  deja_consomme: 'Déjà consommé / vendu',
};
export const RECALL_STATUS_LABELS: Record<RecallStatus, string> = { open: 'Ouvert', blocked: 'Lots bloqués', closed: 'Clôturé' };

const data = <T>(p: Promise<{ data: { data: T } }>) => p.then(r => r.data.data);

export const traceabilityApi = {
  search: (q: string) => data<SearchHit[]>(api.get('/traceability/search', { params: { q } })),
  forward: (id: string) => data<ForwardTrace>(api.get(`/traceability/ingredient-lot/${id}/forward`)),
  backward: (id: string) => data<BackwardTrace>(api.get(`/traceability/product-lot/${id}/backward`)),
  lotSales: (id: string) => data<LotSale[]>(api.get(`/traceability/product-lot/${id}/sales`)),
  recalls: () => data<Recall[]>(api.get('/traceability/recalls')),
  recall: (id: string) => data<Recall & { items: RecallItem[] }>(api.get(`/traceability/recalls/${id}`)),
  createRecall: (body: { originKind: 'ingredient_lot' | 'product_lot'; originId: string; reason: string }) =>
    data<Recall>(api.post('/traceability/recalls', body)),
  block: (id: string) => data<Recall & { items: RecallItem[] }>(api.post(`/traceability/recalls/${id}/block`)),
  setDisposition: (id: string, itemId: string, disposition: Disposition | null, note?: string | null) =>
    data(api.put(`/traceability/recalls/${id}/items/${itemId}`, { disposition, note })),
  close: (id: string, note: string) => data(api.post(`/traceability/recalls/${id}/close`, { note })),
};
