import api from './client';

/** Contrôle & Qualité (mig 313) : vue d'ensemble des anomalies et registre unifié des pertes. */
export type ControlIndicator = {
  key: string;
  domain: 'ventes' | 'achats' | 'production' | 'pertes' | 'haccp' | 'sav';
  label: string;
  hint: string;
  count: number | null;
  value: number | null;
  severity: 'ok' | 'warning' | 'danger' | 'unknown';
  target: 'ventes' | 'achats' | 'production' | 'pertes' | 'haccp' | 'tracabilite' | 'stock' | 'produits' | 'sav';
  aged?: number | null;
  missing?: number | null;
};

export type LossFamily = 'production' | 'invendu' | 'vitrine' | 'perime' | 'recyclage' | 'matiere';

export type LossRow = {
  id: string; source: 'produit' | 'matiere'; family: LossFamily; loss_type: string; reason_code: string | null;
  note: string | null; occurred_at: string; item_id: string; item_name: string; quantity: string; unit: string;
  unit_cost: string | null; value: string | null; cost_missing: boolean; sale_value: string | null;
  declared_by_name: string | null; photo_url: string | null; plan_id: string | null; lot_id: string | null;
};

export type ProductionIssue = {
  kind: 'rendement' | 'qc' | 'pesee' | 'refus'; id: string; occurred_at: string | null;
  plan_id: string | null; plan_date: string | null; label: string; detail: string | null;
  gap: string | null; value: string | null; by_name: string | null;
};

export type ReceptionCheckRow = {
  id: string; voucher_number: string; reception_date: string; supplier_invoice_number: string | null;
  order_number: string | null; supplier_name: string | null; line_count: number; received_by_name: string | null;
  check_id: string | null; temperature_ok: boolean | null; temperature_value: string | null; visual_ok: boolean | null;
  packaging_ok: boolean | null; labels_ok: boolean | null; overall_conformity: boolean | null; check_notes: string | null;
  checked_at: string | null; checked_by_name: string | null; check_status: 'a_controler' | 'conforme' | 'non_conforme';
};

export const controleApi = {
  /** Anomalies de production : rendement, contrôle qualité, pesées hors tolérance, refus du chef. */
  production: (params: Record<string, string>): Promise<{ rows: ProductionIssue[]; total: number; counts: Record<string, number> }> =>
    api.get('/controle/production', { params }).then(r => r.data.data),
  /** Contrôles à réception, par bon de réception. */
  receptions: (params: Record<string, string>): Promise<{ rows: ReceptionCheckRow[]; total: number; counts: Record<string, number> }> =>
    api.get('/controle/receptions', { params }).then(r => r.data.data),
  /** Enregistre (ou remplace) le contrôle d'un bon de réception. */
  saveReceptionCheck: (receptionVoucherId: string, data: {
    temperatureOk: boolean | null; temperatureValue: number | null; visualOk: boolean; packagingOk: boolean;
    labelsOk: boolean; overallConformity: boolean; notes?: string;
  }) => api.post(`/ingredient-lots/quality-check/${receptionVoucherId}`, data).then(r => r.data.data),
  overview: (params: Record<string, string>): Promise<ControlIndicator[]> =>
    api.get('/controle/overview', { params }).then(r => r.data.data),
  lossesSummary: (params: Record<string, string>): Promise<{
    byFamily: { family: LossFamily; count: number; value: string; missing: number }[];
    top: { item_name: string; source: string; unit: string; quantity: string; value: string; count: number }[];
    previousValue: number | null;
  }> => api.get('/controle/losses/summary', { params }).then(r => r.data.data),
  losses: (params: Record<string, string>): Promise<{ rows: LossRow[]; total: number; sumValue: number; missingCost: number }> =>
    api.get('/controle/losses', { params }).then(r => r.data.data),
};
