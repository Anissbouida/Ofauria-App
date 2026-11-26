import api from './client';

/** Facturation à l'avancement — situations de travaux (mig 713). */
export interface ProgressContract {
  id: string; number: string; title: string | null; status: string; customer_name: string | null;
  contract_ht: number; retention_pct: number; advance_amount: number; advance_recovery_pct: number;
  situations: number; cumulative_ht: number; retention_held: number; has_draft: boolean;
}

export interface ProgressPrepared {
  quote: { id: string; number: string; title: string | null };
  situationNo: number;
  settings: { retentionPct: number; advanceAmount: number; advanceRecoveryPct: number; advanceRecoveredBefore: number };
  items: { quoteItemId: string; lot: string | null; label: string; contractAmount: number; tvaRate: number; previousCumulative: number; previousPct: number }[];
}

export interface ProgressBilling {
  id: string; number: string; quote_id: string; quote_number: string; situation_no: number; period_end: string;
  status: 'draft' | 'validated' | 'cancelled';
  contract_ht: string; cumulative_ht: string; previous_ht: string; period_ht: string;
  retention_amount: string; advance_recovery_amount: string; net_ht: string; tax_amount: string; total_ttc: string;
  validated_at: string | null;
  /** Mig 725 : facture émise pour la situation. */
  invoice_id?: string | null;
  lines?: { id: string; quote_item_id: string; label: string; contract_amount: string; pct_cumulative: string; amount_cumulative: string; amount_previous: string; amount_period: string }[];
}

export const progressBillingsApi = {
  contracts: (): Promise<ProgressContract[]> => api.get('/progress-billings/contracts').then(r => r.data.data),
  list: (quoteId: string): Promise<ProgressBilling[]> => api.get('/progress-billings', { params: { quoteId } }).then(r => r.data.data),
  get: (id: string): Promise<ProgressBilling> => api.get(`/progress-billings/${id}`).then(r => r.data.data),
  prepare: (quoteId: string): Promise<ProgressPrepared> => api.get(`/progress-billings/prepare/${quoteId}`).then(r => r.data.data),
  setTerms: (quoteId: string, t: { retentionPct: number; advanceAmount: number; advanceRecoveryPct: number }): Promise<ProgressPrepared> =>
    api.put(`/progress-billings/terms/${quoteId}`, t).then(r => r.data.data),
  saveDraft: (quoteId: string, d: { periodEnd: string; notes?: string; lines: { quoteItemId: string; pctCumulative: number }[] }): Promise<ProgressBilling> =>
    api.post(`/progress-billings/draft/${quoteId}`, d).then(r => r.data.data),
  validate: (id: string): Promise<ProgressBilling> => api.put(`/progress-billings/${id}/validate`).then(r => r.data.data),
  invoice: (id: string): Promise<ProgressBilling> => api.put(`/progress-billings/${id}/invoice`).then(r => r.data.data),
  cancel: (id: string) => api.put(`/progress-billings/${id}/cancel`).then(r => r.data),
};

/** Grilles tarifaires du transport (mig 714). */
export interface FreightBracketRow { id?: string; upTo: number | null; unitPrice: number; flatPrice: number }
export interface FreightGrid {
  id: string; name: string; customer_id: string | null; customer_name: string | null; basis: 'weight' | 'pallet' | 'distance';
  origin_zone: string | null; destination_zone: string | null; minimum_charge: string; tva_rate: string;
  valid_from: string | null; valid_to: string | null; is_active: boolean; brackets: FreightBracketRow[];
}
export interface FreightGridInput {
  name: string; customerId?: string | null; basis: string; originZone?: string | null; destinationZone?: string | null;
  minimumCharge: number; tvaRate: number; validFrom?: string | null; validTo?: string | null; isActive: boolean;
  brackets: { upTo: number | null; unitPrice: number; flatPrice: number }[];
}
export const freightRatesApi = {
  list: (): Promise<FreightGrid[]> => api.get('/freight-rates').then(r => r.data.data),
  create: (g: FreightGridInput) => api.post('/freight-rates', g).then(r => r.data.data),
  update: (id: string, g: FreightGridInput) => api.put(`/freight-rates/${id}`, g).then(r => r.data.data),
  remove: (id: string) => api.delete(`/freight-rates/${id}`).then(r => r.data),
  price: (q: { basis: string; quantity: number; customerId?: string | null; originZone?: string | null; destinationZone?: string | null }):
    Promise<{ gridName: string; amount: number; minimumApplied: boolean; taxAmount: number; totalTtc: number }> =>
    api.post('/freight-rates/price', q).then(r => r.data.data),
};
