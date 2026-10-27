import api from './client';

/** Frais d'approche (mig 361). */
export type AllocationMethod = 'value' | 'quantity';
export type LandedCostStatus = 'draft' | 'applied' | 'cancelled';

export type ReceptionChoice = {
  id: string; voucher_number: string; reception_date: string; order_number: string | null; supplier_name: string | null;
  line_count: number; total_value: string; landed_applied: string;
};
export type PreviewLine = {
  id: string; ingredient_id: string | null; packaging_id: string | null; label: string; unit: string | null; quantity: string; unit_price: string; value: string;
  ingredient_lot_id: string | null; lot_number: string | null; lot_unit_cost: string | null; standard_cost: string | null;
  basis_value: number; share_pct: number; amount: number; unit_increment: number;
};
export type LandedCharge = { id: string; label: string; amount: string; category_id: string | null; category_name: string | null; supplier_id: string | null; supplier_name: string | null; invoice_id: string | null; invoice_number: string | null };
export type LandedAllocation = {
  id: string; reception_voucher_item_id: string; label: string; unit: string | null; lot_number: string | null; unit_price: string; current_cost: string | null;
  basis_value: string; share_pct: string; amount: string; quantity: string; unit_increment: string;
  lot_cost_before: string | null; lot_cost_after: string | null; standard_cost_before: string | null; standard_cost_after: string | null;
};
export type LandedCostVoucher = {
  id: string; number: string; reception_voucher_id: string; reception_number: string; reception_date: string; order_number: string | null; supplier_name: string | null;
  allocation_method: AllocationMethod; status: LandedCostStatus; total_amount: string; notes: string | null;
  applied_at: string | null; applied_by_name: string | null; created_by_name: string | null; created_at: string; charge_count: number; line_count: number;
  charges?: LandedCharge[]; allocations?: LandedAllocation[];
};
export type ChargeInput = { label: string; amount: number; categoryId?: string | null; supplierId?: string | null; invoiceId?: string | null };

export const LANDED_STATUS_LABELS: Record<LandedCostStatus, string> = { draft: 'Brouillon', applied: 'Appliqué', cancelled: 'Annulé' };
export const METHOD_LABELS: Record<AllocationMethod, string> = { value: 'Au prorata de la valeur', quantity: 'Au prorata de la quantité' };

export const landedCostApi = {
  list: (params: Record<string, string>): Promise<{ rows: LandedCostVoucher[]; total: number; appliedTotal: string }> => api.get('/landed-costs', { params }).then(r => r.data.data),
  receptions: (search?: string): Promise<ReceptionChoice[]> => api.get('/landed-costs/receptions', { params: search ? { search } : {} }).then(r => r.data.data),
  preview: (receptionVoucherId: string, total: number, method: AllocationMethod): Promise<PreviewLine[]> =>
    api.get('/landed-costs/preview', { params: { receptionVoucherId, total: String(total), method } }).then(r => r.data.data),
  create: (data: { receptionVoucherId: string; method: AllocationMethod; charges: ChargeInput[]; notes?: string | null }): Promise<LandedCostVoucher> =>
    api.post('/landed-costs', data).then(r => r.data.data),
  get: (id: string): Promise<LandedCostVoucher> => api.get(`/landed-costs/${id}`).then(r => r.data.data),
  apply: (id: string): Promise<LandedCostVoucher> => api.post(`/landed-costs/${id}/apply`).then(r => r.data.data),
  cancel: (id: string): Promise<LandedCostVoucher> => api.post(`/landed-costs/${id}/cancel`).then(r => r.data.data),
};
