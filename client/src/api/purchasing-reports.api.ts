import api from './client';

/** Pilotage des achats (mig 312, D9) : rapprochement par ligne de BC, registre, journal. */
export interface ReportsSummary {
  received_not_invoiced: { lines: number; pos: number; amount: number; aged: number; price_missing: number };
  invoiced_not_received: { lines: number; pos: number; amount: number };
  open_commitments: { pos: number; amount: number };
  invoices_without_lines: { count: number; amount: number };
}
export interface RniRow {
  supplier_id: string; supplier_name: string | null; po_id: string; order_number: string; po_item_id: string;
  item_name: string | null; unit: string | null; qty: string; price_po: string | null; amount_at_po_price: string;
  price_missing: boolean; price_overwritten: boolean; last_received_at: string | null; age_days: number | null;
}
export interface InrRow {
  supplier_name: string | null; po_id: string; order_number: string; po_item_id: string; item_name: string | null;
  unit: string | null; qty: string; amount_invoiced: string; qty_received: string; qty_invoiced: string; age_days: number | null;
}
export interface CommitmentRow {
  supplier_name: string | null; po_id: string; order_number: string; po_status: string; order_date: string;
  open_lines: number; amount: string; price_missing: boolean;
}
export interface InvoiceWithoutLines { invoice_id: string; invoice_number: string; invoice_date: string; supplier_name: string | null; total_amount: string }
export interface RegisterRow {
  source: 'bc' | 'hors_bc'; entry_date: string; voucher_number: string | null; order_number: string | null;
  supplier_name: string | null; supplier_ice: string | null; item_name: string | null; quantity: string; unit: string | null;
  container_label: string | null; supplier_lot: string | null; internal_lot: string | null; dlc: string | null;
  overall_conformity: boolean | null; temperature_value: string | null; supplier_invoice_number: string | null;
  received_by: string | null; incomplete: boolean; line_kind: string | null;
}

/** Télécharge un CSV généré par le serveur (fichier complet, pas une capture d'écran). */
async function downloadCsv(url: string, params: Record<string, unknown>, fallbackName: string) {
  const r = await api.get(url, { params: { ...params, format: 'csv' }, responseType: 'blob' });
  const cd = String(r.headers['content-disposition'] ?? '');
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
  const href = URL.createObjectURL(r.data as Blob);
  const a = document.createElement('a');
  a.href = href; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(href); }, 1000);
}

export type PilotageKind = 'commitments' | 'rni' | 'inr' | 'nolines';
export type PilotageBoard = { rows: Record<string, any>[]; total: number; sumAmount: number; page: number; pageSize: number };

export const purchasingReportsApi = {
  /** Écran Pilotage : une liste de rapprochement paginée, au détail ou par fournisseur. */
  board: (params: Record<string, string>): Promise<PilotageBoard> =>
    api.get('/purchasing/reports/board', { params }).then(r => r.data.data),
  summary: (): Promise<ReportsSummary> => api.get('/purchasing/reports/summary').then(r => r.data.data),
  receivedNotInvoiced: (params?: { supplierId?: string; minAgeDays?: number }): Promise<RniRow[]> =>
    api.get('/purchasing/reports/received-not-invoiced', { params }).then(r => r.data.data),
  invoicedNotReceived: (): Promise<InrRow[]> => api.get('/purchasing/reports/invoiced-not-received').then(r => r.data.data),
  openCommitments: (): Promise<CommitmentRow[]> => api.get('/purchasing/reports/open-commitments').then(r => r.data.data),
  invoicesWithoutLines: (): Promise<InvoiceWithoutLines[]> => api.get('/purchasing/reports/invoices-without-lines').then(r => r.data.data),
  /** Registre des entrées paginé (écran Stock › Registre) + compteurs de la période. */
  registerBoard: (params: Record<string, string>): Promise<{ rows: RegisterRow[]; total: number; counts: { all: number; incomplete: number; nonconform: number; hors_bc: number } }> =>
    api.get('/purchasing/reports/goods-entry-register/board', { params }).then(r => r.data.data),
  register: (params: { from?: string; to?: string; supplierId?: string; lot?: string; incompleteOnly?: boolean }): Promise<RegisterRow[]> =>
    api.get('/purchasing/reports/goods-entry-register', { params: { ...params, incompleteOnly: params.incompleteOnly ? 'true' : undefined } }).then(r => r.data.data),
  exportReceivedNotInvoiced: () => downloadCsv('/purchasing/reports/received-not-invoiced', {}, 'recu-non-facture.csv'),
  exportRegister: (params: { from?: string; to?: string; supplierId?: string; lot?: string; incompleteOnly?: boolean }) =>
    downloadCsv('/purchasing/reports/goods-entry-register', { ...params, incompleteOnly: params.incompleteOnly ? 'true' : undefined }, 'registre-entrees.csv'),
  exportPurchaseJournal: (from: string, to: string) =>
    downloadCsv('/purchasing/reports/purchase-journal', { from, to }, `journal-achats-${from}-${to}.csv`),
};
